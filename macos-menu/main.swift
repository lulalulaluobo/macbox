import AppKit
import Foundation
import Darwin

/// A small native menu-bar companion for the Web-first MacBox distribution.
///
/// The helper deliberately owns only processes and files that belong to
/// MacBox. It never scans or removes unrelated Lima instances, Docker data,
/// or host processes.
final class MenuBarDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private enum WebServiceState {
        case checking
        case running
        case stopped

        var label: String {
            switch self {
            case .checking: return "检查中"
            case .running: return "运行中"
            case .stopped: return "未运行"
            }
        }

        var color: NSColor {
            switch self {
            case .checking: return .systemOrange
            case .running: return .systemGreen
            case .stopped: return .systemOrange
            }
        }

        var symbolName: String {
            switch self {
            case .checking: return "circle.dotted"
            case .running: return "checkmark.circle.fill"
            case .stopped: return "pause.circle.fill"
            }
        }
    }

    private struct MenuBarStatus: Decodable {
        let cpuPercent: Double?
        let memUsed: UInt64?
        let memTotal: UInt64?
        let memPercent: Double?
        let storageName: String?
        let storageUsed: UInt64?
        let storageTotal: UInt64?
        let storageUsedPercent: Double?
        let limaInstalled: Bool?
        let vmStatus: String?
        let dockerReady: Bool?
        let dockerTotal: Int?
        let dockerRunning: Int?
    }

    private let fileManager = FileManager.default
    private let home = FileManager.default.homeDirectoryForCurrentUser.path
    private let defaultPort = 19808

    private var statusItem: NSStatusItem!
    private var menu: NSMenu!
    private var statusMenuItem: NSMenuItem!
    private var backendProcess: Process?
    private var backendLogHandle: FileHandle?
    private var actionInProgress = false
    private var backendRunning = false
    private var monitorRequestInFlight = false
    private var webServiceState: WebServiceState = .checking
    private var monitorHeaderItem: NSMenuItem!
    private var cpuMonitorItem: NSMenuItem!
    private var memoryMonitorItem: NSMenuItem!
    private var storageMonitorItem: NSMenuItem!
    private var servicesMonitorItem: NSMenuItem!
    private var port: Int { configuredPort() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        buildMenu()
        applyStatusVisual(.checking)
        refreshStatus(nil)
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.refreshStatus(nil)
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        refreshStatus(nil)
    }

    private func buildMenu() {
        menu = NSMenu()
        menu.delegate = self

        statusMenuItem = NSMenuItem(title: "MacBox · 检查中", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        monitorHeaderItem = disabledItem("资源监控（每 5 秒更新）")
        monitorHeaderItem.indentationLevel = 1
        menu.addItem(monitorHeaderItem)
        cpuMonitorItem = disabledItem("CPU：—")
        memoryMonitorItem = disabledItem("内存：—")
        storageMonitorItem = disabledItem("存储：—")
        servicesMonitorItem = disabledItem("Lima：— · Docker：—")
        for monitorItem in [cpuMonitorItem!, memoryMonitorItem!, storageMonitorItem!, servicesMonitorItem!] {
            monitorItem.indentationLevel = 1
            menu.addItem(monitorItem)
        }
        menu.addItem(.separator())
        menu.addItem(item("打开网页端", #selector(openWeb)))
        menu.addItem(.separator())
        menu.addItem(item("启动后端服务", #selector(startBackend)))
        menu.addItem(item("停止后端服务", #selector(stopBackend)))
        menu.addItem(item("启动 Lima 虚拟机", #selector(startLima)))
        menu.addItem(item("停止 Lima 虚拟机", #selector(stopLima)))
        menu.addItem(item("刷新状态", #selector(refreshStatus)))
        menu.addItem(.separator())
        menu.addItem(item("打开日志", #selector(openLog)))
        menu.addItem(.separator())
        menu.addItem(item("卸载程序（保留实例和数据）", #selector(uninstallProgram)))
        menu.addItem(item("彻底卸载（实例、镜像和配置）", #selector(uninstallAll)))
        menu.addItem(.separator())
        menu.addItem(item("退出菜单栏助手", #selector(quit)))
        statusItem.menu = menu
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: "")
        result.target = self
        return result
    }

    private func disabledItem(_ title: String) -> NSMenuItem {
        let result = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        result.isEnabled = false
        return result
    }

    @objc private func openWeb(_ sender: Any?) {
        guard let url = URL(string: "http://127.0.0.1:\(port)") else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func refreshStatus(_ sender: Any?) {
        // Show an explicit visual transition for the initial check, a manual
        // refresh, and actions that are currently changing the service state.
        if sender != nil || actionInProgress || webServiceState == .checking {
            applyStatusVisual(.checking)
        }
        checkBackend { [weak self] running in
            guard let self else { return }
            self.backendRunning = running
            self.applyStatusVisual(running ? .running : .stopped)
            if running {
                self.refreshMonitoringStatus()
            } else {
                self.updateMonitoringItems(nil)
            }
        }
    }

    private func applyStatusVisual(_ state: WebServiceState) {
        webServiceState = state
        statusMenuItem.title = "MacBox · Web 服务\(state.label)（端口 \(port)）"
        statusMenuItem.image = symbolImage(state.symbolName, color: state.color, size: NSSize(width: 15, height: 15))

        if let button = statusItem.button {
            button.image = symbolImage("server.rack", color: state.color, size: NSSize(width: 18, height: 18))
                ?? NSImage(named: NSImage.applicationIconName)
            button.image?.isTemplate = false
            button.toolTip = "MacBox：Web 服务\(state.label)"
        }
    }

    private func symbolImage(_ name: String, color: NSColor, size: NSSize) -> NSImage? {
        guard let image = NSImage(systemSymbolName: name, accessibilityDescription: "MacBox")?
            .withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [color])) else {
            return nil
        }
        image.isTemplate = false
        image.size = size
        return image
    }

    private func refreshMonitoringStatus() {
        guard backendRunning, !monitorRequestInFlight else { return }
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/system/menubar-status") else { return }

        monitorRequestInFlight = true
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2.5)
        request.httpMethod = "GET"
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let status: MenuBarStatus?
            if (response as? HTTPURLResponse)?.statusCode == 200, let data {
                status = try? JSONDecoder().decode(MenuBarStatus.self, from: data)
            } else {
                status = nil
            }
            DispatchQueue.main.async {
                guard let self else { return }
                self.monitorRequestInFlight = false
                self.updateMonitoringItems(status)
            }
        }.resume()
    }

    private func updateMonitoringItems(_ status: MenuBarStatus?) {
        guard let status else {
            cpuMonitorItem?.title = "CPU：—"
            memoryMonitorItem?.title = "内存：—"
            storageMonitorItem?.title = "存储：—"
            servicesMonitorItem?.title = "Lima：— · Docker：—"
            return
        }

        cpuMonitorItem.title = "CPU：\(formatPercent(status.cpuPercent))"
        if let used = status.memUsed, let total = status.memTotal {
            memoryMonitorItem.title = "内存：\(formatBytes(used)) / \(formatBytes(total))（\(formatPercent(status.memPercent))）"
        } else {
            memoryMonitorItem.title = "内存：\(formatPercent(status.memPercent))"
        }
        let storageLabel = status.storageName ?? "—"
        storageMonitorItem.title = "存储：\(storageLabel) · \(formatPercent(status.storageUsedPercent))"

        let limaLabel: String
        if status.limaInstalled != true {
            limaLabel = "未安装"
        } else {
            limaLabel = vmStatusLabel(status.vmStatus)
        }
        let dockerLabel: String
        if let running = status.dockerRunning, let total = status.dockerTotal {
            dockerLabel = "Docker \(running)/\(total)"
        } else if status.dockerReady == true {
            dockerLabel = "Docker 就绪"
        } else {
            dockerLabel = "Docker 未就绪"
        }
        servicesMonitorItem.title = "Lima：\(limaLabel) · \(dockerLabel)"
    }

    private func vmStatusLabel(_ status: String?) -> String {
        switch status {
        case "Running": return "运行中"
        case "Stopped": return "已停止"
        case "NotCreated": return "未创建"
        case "Broken": return "异常"
        default: return status ?? "未知"
        }
    }

    private func formatPercent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.0f%%", max(0, min(100, value)))
    }

    private func formatBytes(_ value: UInt64) -> String {
        let units = ["B", "KB", "MB", "GB", "TB"]
        var amount = Double(value)
        var index = 0
        while amount >= 1024 && index < units.count - 1 {
            amount /= 1024
            index += 1
        }
        if index == 0 { return "\(value) B" }
        return String(format: "%.1f %@", amount, units[index])
    }

    @objc private func startBackend(_ sender: Any?) {
        guard !actionInProgress else { return }
        actionInProgress = true
        applyStatusVisual(.checking)
        checkBackend { [weak self] alreadyRunning in
            guard let self else { return }
            if alreadyRunning {
                self.actionInProgress = false
                self.openWeb(nil)
                self.showAlert(title: "MacBox 已在运行", message: "Web 服务已经运行在端口 \(self.port)。")
                return
            }

            guard let binary = self.locateBackendBinary() else {
                self.actionInProgress = false
                self.showAlert(title: "找不到 MacBox", message: "没有找到 macbox 可执行文件。请先运行发行包中的 install.sh，或从完整发行包启动菜单栏助手。", style: .warning)
                return
            }

            do {
                let stateURL = self.fileManager.homeDirectoryForCurrentUser.appendingPathComponent(".macbox", isDirectory: true)
                try self.fileManager.createDirectory(at: stateURL, withIntermediateDirectories: true)
                let logURL = stateURL.appendingPathComponent("macbox.log")
                if !self.fileManager.fileExists(atPath: logURL.path) {
                    self.fileManager.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
                }
                guard let logHandle = try? FileHandle(forWritingTo: logURL) else {
                    throw NSError(domain: "MacBoxMemu", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法打开菜单栏日志文件"])
                }
                try logHandle.seekToEnd()
                logHandle.write(Data("\n[MacBox Menu] 启动 Web 服务\n".utf8))

                let process = Process()
                process.executableURL = URL(fileURLWithPath: binary)
                process.arguments = ["--host", "0.0.0.0", "--port", String(self.port)]
                process.standardOutput = logHandle
                process.standardError = logHandle
                process.terminationHandler = { [weak self] _ in
                    DispatchQueue.main.async {
                        self?.backendProcess = nil
                        try? self?.backendLogHandle?.close()
                        self?.backendLogHandle = nil
                        self?.refreshStatus(nil)
                    }
                }
                try process.run()
                self.backendProcess = process
                self.backendLogHandle = logHandle
                self.writePID(process.processIdentifier)
                self.waitForBackend(retries: 40)
            } catch {
                self.actionInProgress = false
                self.showAlert(title: "MacBox 启动失败", message: error.localizedDescription, style: .warning)
            }
        }
    }

    private func waitForBackend(retries: Int) {
        checkBackend { [weak self] ready in
            guard let self else { return }
            if ready {
                self.actionInProgress = false
                self.refreshStatus(nil)
                self.openWeb(nil)
                self.showAlert(title: "MacBox 已启动", message: "Web 服务已启动并支持局域网访问。\n\n本机：http://127.0.0.1:\(self.port)\n日志：\(self.logPath())")
                return
            }
            if retries <= 0 {
                self.actionInProgress = false
                self.refreshStatus(nil)
                self.showAlert(title: "MacBox 正在启动", message: "启动命令已执行，但服务还没有返回。请稍后点击“刷新状态”，或打开日志查看原因。\n\n日志：\(self.logPath())", style: .warning)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.waitForBackend(retries: retries - 1)
            }
        }
    }

    @objc private func stopBackend(_ sender: Any?) {
        stopBackendProcess(silent: false, completion: nil)
    }

    private func stopBackendProcess(silent: Bool, completion: (() -> Void)?) {
        guard !actionInProgress || silent else { return }
        actionInProgress = true
        applyStatusVisual(.checking)
        let pid = ownedBackendPID()
        let launchAgent = launchAgentPath()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            var stopped = false
            if let pid, kill(pid, SIGTERM) == 0 {
                stopped = true
                for _ in 0..<20 {
                    if kill(pid, 0) != 0 { break }
                    usleep(250_000)
                }
                if kill(pid, 0) == 0 { _ = kill(pid, SIGKILL) }
                self.removePID()
            }
            if self.fileManager.fileExists(atPath: launchAgent) {
                _ = self.runSync("/bin/launchctl", arguments: ["bootout", "gui/\(getuid())", launchAgent])
                try? self.fileManager.removeItem(atPath: launchAgent)
                stopped = true
            }
            DispatchQueue.main.async {
                self.actionInProgress = false
                self.refreshStatus(nil)
                completion?()
                if !silent {
                    let message = stopped
                        ? "MacBox Web 服务已停止。"
                        : "没有找到由 MacBox 控制器启动的服务，未强制终止其他程序。"
                    self.showAlert(title: stopped ? "MacBox 已停止" : "MacBox 未运行", message: message, style: stopped ? .informational : .warning)
                }
            }
        }
    }

    @objc private func startLima(_ sender: Any?) {
        runLima(arguments: ["start", configuredVMName(), "--tty=false"], title: "启动 Lima 虚拟机")
    }

    @objc private func stopLima(_ sender: Any?) {
        runLima(arguments: ["stop", configuredVMName(), "--tty=false"], title: "停止 Lima 虚拟机")
    }

    private func runLima(arguments: [String], title: String) {
        guard !actionInProgress else { return }
        guard let limactl = locateLima() else {
            showAlert(title: "找不到 Lima", message: "没有检测到 limactl。请先打开 Web 端完成初始化，或在终端执行 brew install lima。", style: .warning)
            return
        }
        actionInProgress = true
        runAsync(limactl, arguments: arguments, input: nil) { [weak self] status, output in
            guard let self else { return }
            self.actionInProgress = false
            if status == 0 {
                self.showAlert(title: "\(title)完成", message: output.isEmpty ? "操作已完成。" : String(output.suffix(1200)))
            } else {
                self.showAlert(title: "\(title)失败", message: self.shortOutput(output, fallback: "请打开 Web 端诊断中心查看具体错误。"), style: .warning)
            }
        }
    }

    @objc private func openLog(_ sender: Any?) {
        let path = logPath()
        if !fileManager.fileExists(atPath: path) {
            fileManager.createFile(atPath: path, contents: Data(), attributes: [.posixPermissions: 0o600])
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    @objc private func uninstallProgram(_ sender: Any?) {
        guard confirm(title: "卸载 MacBox 程序", message: "只移除 MacBox 程序和菜单栏助手，保留 Lima 实例、Docker 数据和配置。继续吗？") else { return }
        guard let script = locateScript("uninstall.sh") else {
            showAlert(title: "卸载失败", message: "找不到 uninstall.sh，请从完整发行包启动菜单栏助手。", style: .warning)
            return
        }
        stopBackendProcess(silent: true) { [weak self] in
            self?.runUninstall(script: script, arguments: [])
        }
    }

    @objc private func uninstallAll(_ sender: Any?) {
        guard confirm(title: "彻底卸载 MacBox", message: "将删除 MacBox 专属 Lima 实例、管理盘、Docker 容器/镜像/卷、配置和程序。其他 Lima 实例及宿主机无关数据不会删除。继续吗？") else { return }
        guard let script = locateScript("uninstall.sh") else {
            showAlert(title: "卸载失败", message: "找不到 uninstall.sh，请从完整发行包启动菜单栏助手。", style: .warning)
            return
        }
        stopBackendProcess(silent: true) { [weak self] in
            self?.runUninstall(script: script, arguments: ["--purge"], input: "DELETE\n")
        }
    }

    private func runUninstall(script: String, arguments: [String], input: String? = nil) {
        actionInProgress = true
        runAsync(script, arguments: arguments, input: input) { [weak self] status, output in
            guard let self else { return }
            self.actionInProgress = false
            if status == 0 {
                self.showAlert(title: "MacBox 已卸载", message: output.isEmpty ? "卸载操作已完成。" : String(output.suffix(1600)))
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    NSApplication.shared.terminate(nil)
                }
            } else {
                self.showAlert(title: "卸载失败", message: self.shortOutput(output, fallback: "请在终端执行 uninstall.sh 查看详细错误。"), style: .warning)
            }
        }
    }

    @objc private func quit(_ sender: Any?) {
        NSApplication.shared.terminate(nil)
    }

    private func checkBackend(completion: @escaping (Bool) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/auth/status") else {
            completion(false)
            return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1.0)
        request.httpMethod = "GET"
        URLSession.shared.dataTask(with: request) { _, response, _ in
            let ready = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { completion(ready) }
        }.resume()
    }

    private func configuredPort() -> Int {
        let path = fileManager.homeDirectoryForCurrentUser.appendingPathComponent(".macbox/config.yaml").path
        guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else { return defaultPort }
        for line in contents.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("port:") else { continue }
            if let value = Int(trimmed.dropFirst("port:".count).trimmingCharacters(in: .whitespaces)), (1...65535).contains(value) {
                return value
            }
        }
        return defaultPort
    }

    private func configuredVMName() -> String {
        let path = fileManager.homeDirectoryForCurrentUser.appendingPathComponent(".macbox/config.yaml").path
        guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else { return "macbox" }
        var inVM = false
        for line in contents.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed == "vm:" {
                inVM = true
                continue
            }
            if inVM && !line.hasPrefix(" ") && !line.hasPrefix("\t") {
                inVM = false
            }
            guard inVM, trimmed.hasPrefix("name:") else { continue }
            let value = trimmed.dropFirst("name:".count).trimmingCharacters(in: .whitespaces)
            if !value.isEmpty { return String(value) }
        }
        return "macbox"
    }

    private func locateBackendBinary() -> String? {
        let installed = home + "/.local/share/macbox/bin/macbox"
        if fileManager.isExecutableFile(atPath: installed) { return installed }
        let release = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("bin/macbox").path
        if fileManager.isExecutableFile(atPath: release) { return release }
        return nil
    }

    private func locateScript(_ name: String) -> String? {
        let installed = home + "/.local/share/macbox/\(name)"
        if fileManager.isExecutableFile(atPath: installed) { return installed }
        let release = Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent(name).path
        if fileManager.isExecutableFile(atPath: release) { return release }
        return nil
    }

    private func locateLima() -> String? {
        let candidates = [
            "/opt/homebrew/bin/limactl",
            "/usr/local/bin/limactl",
            "/usr/bin/limactl"
        ]
        if let path = candidates.first(where: { fileManager.isExecutableFile(atPath: $0) }) { return path }
        let path = runSync("/bin/sh", arguments: ["-lc", "command -v limactl"]).trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : path
    }

    private func launchAgentPath() -> String {
        home + "/Library/LaunchAgents/com.macbox.server.plist"
    }

    private func logPath() -> String {
        home + "/.macbox/macbox.log"
    }

    private func writePID(_ pid: Int32) {
        let path = home + "/.macbox/macbox.menu.pid"
        try? String(pid).write(toFile: path, atomically: true, encoding: .utf8)
    }

    private func removePID() {
        try? fileManager.removeItem(atPath: home + "/.macbox/macbox.menu.pid")
        try? fileManager.removeItem(atPath: home + "/.macbox/macbox.command.pid")
    }

    private func ownedBackendPID() -> Int32? {
        var candidates: [String] = [home + "/.macbox/macbox.menu.pid", home + "/.macbox/macbox.command.pid"]
        if let runningPID = backendProcess?.processIdentifier { candidates.insert(String(runningPID), at: 0) }
        let binaries = [home + "/.local/share/macbox/bin/macbox", Bundle.main.bundleURL.deletingLastPathComponent().appendingPathComponent("bin/macbox").path]
        for value in candidates {
            guard let pid = Int32(value.trimmingCharacters(in: .whitespacesAndNewlines)), pid > 1 else { continue }
            let command = runSync("/bin/ps", arguments: ["-p", String(pid), "-o", "command="])
            if binaries.contains(where: { command.contains($0) }) { return pid }
        }
        return nil
    }

    private func runAsync(_ path: String, arguments: [String], input: String?, completion: @escaping (Int32, String) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process()
            let outputPipe = Pipe()
            let inputPipe = Pipe()
            process.executableURL = URL(fileURLWithPath: path)
            process.arguments = arguments
            process.standardOutput = outputPipe
            process.standardError = outputPipe
            if input != nil { process.standardInput = inputPipe }
            do {
                try process.run()
                if let input {
                    inputPipe.fileHandleForWriting.write(Data(input.utf8))
                    inputPipe.fileHandleForWriting.closeFile()
                }
                let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let text = String(data: data, encoding: .utf8) ?? ""
                DispatchQueue.main.async { completion(process.terminationStatus, text) }
            } catch {
                DispatchQueue.main.async { completion(1, error.localizedDescription) }
            }
        }
    }

    private func runSync(_ path: String, arguments: [String]) -> String {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return String(data: data, encoding: .utf8) ?? ""
        } catch {
            return ""
        }
    }

    private func confirm(title: String, message: String) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "取消")
        alert.addButton(withTitle: "继续")
        return alert.runModal() == .alertSecondButtonReturn
    }

    private func showAlert(title: String, message: String, style: NSAlert.Style = .informational) {
        let alert = NSAlert()
        alert.alertStyle = style
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    private func shortOutput(_ output: String, fallback: String) -> String {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.suffix(1800))
    }
}

@main
struct MacBoxMemuMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = MenuBarDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}
