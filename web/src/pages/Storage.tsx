import React, { useState, useEffect } from 'react';
import { HardDrive, Check, Copy, KeyRound, CheckCircle2, AlertCircle, RefreshCw, FolderLock, RotateCw, Layers, X } from 'lucide-react';
import { DiskInfo, ManagedDisk, SambaStatus } from '../types';
import { api } from '../api';

export const Storage: React.FC = () => {
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [managedDisks, setManagedDisks] = useState<ManagedDisk[]>([]);
  const [selectedDiskId, setSelectedDiskId] = useState<string>('');
  const [isExternalActive, setIsExternalActive] = useState<boolean>(false);
  const [dataPath, setDataPath] = useState<string>('');
  const [samba, setSamba] = useState<SambaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Password Modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // External Disk Bind Modal
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindingDisk, setBindingDisk] = useState<DiskInfo | null>(null);
  const [bindSizeGB, setBindSizeGB] = useState<number>(100);
  const [bindLoading, setBindLoading] = useState(false);
  const [restartPrompt, setRestartPrompt] = useState(false);
  const [restartingVM, setRestartingVM] = useState(false);

  const [alertMsg, setAlertMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [storageRes, sambaRes] = await Promise.all([
        api.getDisks(),
        api.getSambaStatus(),
      ]);
      setDisks(storageRes.disks || []);
      setManagedDisks(storageRes.managedDisks || []);
      setSelectedDiskId(storageRes.selectedDisk || '');
      setIsExternalActive(storageRes.isExternalActive || false);
      setDataPath(storageRes.dataPath || '');
      setSamba(sambaRes);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `加载存储数据失败: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectDisk = async (identifier: string) => {
    try {
      await api.selectDisk(identifier);
      setSelectedDiskId(identifier);
      setAlertMsg({ type: 'success', text: `已成功选择磁盘 ${identifier} 作为 NAS 数据盘目标！` });
      loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `选择失败: ${err.message}` });
    }
  };

  const handleOpenBindModal = (disk: DiskInfo) => {
    setBindingDisk(disk);
    // Estimate sensible size: min(200GB, 80% free space if available, max 50GB)
    let defaultGB = 100;
    if (disk.freeSpace > 0) {
      const freeGB = Math.floor(disk.freeSpace / (1024 * 1024 * 1024));
      if (freeGB > 10) {
        defaultGB = Math.min(500, Math.floor(freeGB * 0.8));
      }
    }
    setBindSizeGB(defaultGB);
    setShowBindModal(true);
  };

  const handleConfirmBind = async () => {
    if (!bindingDisk) return;
    setBindLoading(true);
    try {
      const res = await api.bindStorage(bindingDisk.identifier, bindingDisk.mountPoint, bindSizeGB);
      setAlertMsg({ type: 'success', text: res.message });
      setShowBindModal(false);
      setRestartPrompt(true);
      loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `绑定外接盘失败: ${err.message}` });
    } finally {
      setBindLoading(false);
    }
  };

  const handleUnbind = async () => {
    if (!confirm('确定要切回内置虚拟数据盘吗？外接盘上的数据将安全保留。')) return;
    try {
      const res = await api.unbindStorage();
      setAlertMsg({ type: 'success', text: res.message });
      setRestartPrompt(true);
      loadData();
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `解除绑定失败: ${err.message}` });
    }
  };

  const handleRestartVM = async () => {
    setRestartingVM(true);
    try {
      await api.restartVM();
      setAlertMsg({ type: 'success', text: '正在重启虚拟机以挂载新数据盘，请稍候约 30 秒...' });
      setRestartPrompt(false);
      setTimeout(() => {
        loadData();
        setRestartingVM(false);
      }, 5000);
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `重启虚拟机失败: ${err.message}` });
      setRestartingVM(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim()) return;
    setPasswordLoading(true);
    try {
      await api.updateSambaPassword(newPassword.trim());
      setAlertMsg({ type: 'success', text: 'Samba 访问密码已更新！' });
      setShowPasswordModal(false);
      setNewPassword('');
    } catch (err: any) {
      setAlertMsg({ type: 'error', text: `密码修改失败: ${err.message}` });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleCopySMB = () => {
    if (samba?.address) {
      navigator.clipboard.writeText(samba.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white">存储与共享管理</h2>
          <p className="text-sm text-slate-400 mt-1">自动识别 Mac 外接存储，独立管理 ext4 数据盘与 Samba 局域网共享。</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新磁盘列表</span>
        </button>
      </div>

      {/* Alert Banner */}
      {alertMsg && (
        <div className={`p-4 rounded-xl text-sm flex items-center justify-between ${
          alertMsg.type === 'success'
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
        }`}>
          <div className="flex items-center space-x-2">
            {alertMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{alertMsg.text}</span>
          </div>
          <button onClick={() => setAlertMsg(null)} className="text-xs opacity-70 hover:opacity-100">关闭</button>
        </div>
      )}

      {/* Restart VM Alert Banner */}
      {restartPrompt && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2.5">
            <RotateCw className="w-4 h-4 text-amber-400" />
            <span>数据盘挂载配置已变更！需要重启 Linux 虚拟机以重新加载数据卷挂载生效。</span>
          </div>
          <button
            onClick={handleRestartVM}
            disabled={restartingVM}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow transition flex items-center space-x-1"
          >
            <RotateCw className={`w-3.5 h-3.5 ${restartingVM ? 'animate-spin' : ''}`} />
            <span>{restartingVM ? '重启中...' : '立即重启 VM'}</span>
          </button>
        </div>
      )}

      {/* Section 1: SMB File Sharing Card */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-indigo-950/40 border border-slate-800/90 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <FolderLock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold text-white">Samba (SMB) 局域网文件共享</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  samba?.status === 'running' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                }`}>
                  {samba?.status === 'running' ? '运行中' : '已停止'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">供 Windows 资源管理器、Mac Finder 及移动端电视盒子通过标准 SMB 访问。</p>
            </div>
          </div>

          <button
            onClick={() => setShowPasswordModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
          >
            <KeyRound className="w-3.5 h-3.5 text-sky-400" />
            <span>修改共享密码</span>
          </button>
        </div>

        {/* SMB Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-800">
            <span className="text-xs text-slate-400">共享连接地址 (局域网)</span>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-sm font-mono font-bold text-sky-300 select-all truncate">
                {samba?.address || 'smb://127.0.0.1:4455/MacNAS'}
              </span>
              <button
                onClick={handleCopySMB}
                title="复制连接串"
                className="ml-2 p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-800">
            <span className="text-xs text-slate-400">默认共享账户</span>
            <p className="text-base font-bold text-white mt-1 font-mono">{samba?.user || 'macnas'}</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-800">
            <span className="text-xs text-slate-400">挂载目录</span>
            <p className="text-base font-bold text-white mt-1 font-mono">/data</p>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-800 text-xs text-slate-400 flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          <span>连接说明: 在 Mac Finder 按快捷键 <code>Cmd + K</code>，输入上方地址即可连接；Windows 资源管理器在地址栏输入 <code>\\&lt;IP&gt;\MacNAS</code> 即可。</span>
        </div>
      </div>

      {/* Section 2: NAS Storage Physical Mapping Architecture */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <Layers className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white">NAS 存储物理映射拓扑 (宿主机 ↔ 虚拟机 ↔ 共享)</h3>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
            {isExternalActive ? '外接存储镜像模式' : '内置隔离镜像模式'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 space-y-1.5">
            <span className="text-slate-400 font-bold block">💻 Mac 宿主机实际文件路径</span>
            <p className="font-mono text-sky-300 break-all select-all font-semibold text-[11px]">
              {dataPath || '~/.lima/_disks/macnas-data/datadisk'}
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              数据保存在独立虚拟磁盘中，绝对不修改或抹除您磁盘上原有的任何照片、文档与 macOS 系统数据。
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 space-y-1.5">
            <span className="text-slate-400 font-bold block">🐧 Linux 虚拟机内部挂载点</span>
            <p className="font-mono text-emerald-300 font-bold text-sm">/data</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              底层格式化为原生 ext4 高速文件系统，彻底规避网络共享文件锁导致 Docker 数据库崩溃的隐患。
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 space-y-1.5">
            <span className="text-slate-400 font-bold block">🐳 Docker 容器各应用路径映射</span>
            <div className="space-y-0.5 font-mono text-[11px] text-slate-300">
              <div>• 影音媒体: <span className="text-sky-300">/data/media</span> (Jellyfin)</div>
              <div>• 离线下载: <span className="text-sky-300">/data/downloads</span> (qBittorrent)</div>
              <div>• 全盘文件: <span className="text-sky-300">/data</span> (FileBrowser / Alist)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Physical Disks List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">识别到的物理磁盘列表</h3>
            <p className="text-xs text-slate-400 mt-0.5">自动识别 APFS 卷与真实挂载点。推荐使用高速外接固态硬盘作为 NAS 数据盘。</p>
          </div>
          <span className="text-xs text-slate-400 font-mono">已识别 {disks.length} 个物理存储设备</span>
        </div>

        {disks.length === 0 && !loading ? (
          <div className="p-8 rounded-2xl bg-slate-900/40 border border-dashed border-slate-800 text-center text-slate-400 text-sm">
            未扫描到外接磁盘设备，请检查 USB/雷电外接硬盘是否插好。
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {disks.map((disk) => {
              const isSelected = disk.identifier === selectedDiskId || disk.deviceNode === selectedDiskId || disk.isSelected;
              return (
                <div
                  key={disk.identifier}
                  className={`p-5 rounded-2xl border transition-all flex flex-col justify-between space-y-4 ${
                    isSelected
                      ? 'bg-slate-900/90 border-sky-500/60 shadow-lg shadow-sky-500/10 ring-1 ring-sky-500/30'
                      : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          disk.isExternal ? 'bg-sky-500/10 text-sky-400' : 'bg-slate-800 text-slate-400'
                        }`}>
                          <HardDrive className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h4 className="font-bold text-white text-base truncate max-w-[200px]" title={disk.name}>
                              {disk.name}
                            </h4>
                            {disk.isExternal && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                                外接磁盘
                              </span>
                            )}
                            {disk.isSSD && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-slate-800 text-slate-300">
                                SSD
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">
                            {disk.volumeName ? `${disk.volumeName} · ` : ''}{disk.deviceNode} · {disk.fileSystem || 'RAW'}
                          </p>
                        </div>
                      </div>

                      {isSelected && (
                        <span className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <Check className="w-3.5 h-3.5" />
                          <span>当前 NAS 数据盘</span>
                        </span>
                      )}
                    </div>

                    {/* Capacity Bar */}
                    <div className="mt-4 space-y-1.5">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>总容量: <strong className="text-white">{disk.totalSizeString}</strong></span>
                        <span>
                          {disk.usedSpaceString ? `已用 ${disk.usedSpaceString} / 剩余 ${disk.freeSpaceString}` : (disk.usedPercent > 0 ? `${disk.usedPercent.toFixed(1)}% 已使用` : '就绪')}
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${isSelected ? 'bg-sky-500' : 'bg-slate-600'}`}
                          style={{ width: `${Math.min(disk.usedPercent || 0, 100)}%` }}
                        />
                      </div>
                    </div>

                    {disk.mountPoint === '/System/Volumes/Data' && (
                      <div className="mt-2.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 flex items-center space-x-1.5">
                        <span>💡</span>
                        <span>当前 Mac 的主引导系统与数据盘（包含您的现有系统与个人文件，100% 安全共存）</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="pt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between border-t border-slate-800/60 text-xs gap-2">
                    <span className="text-slate-400 truncate max-w-[220px]" title={disk.mountPoint}>
                      {disk.mountPoint ? `挂载点: ${disk.mountPoint}` : (disk.mounted ? '已挂载' : '未挂载系统目录')}
                    </span>

                    <div className="flex items-center space-x-2 shrink-0">
                      {isSelected ? (
                        <>
                          {isExternalActive ? (
                            <div className="flex items-center space-x-2">
                              <span className="text-[11px] text-emerald-400 font-mono truncate max-w-[140px]" title={dataPath}>
                                镜像: {dataPath ? dataPath.split('/').pop() : 'datadisk.img'}
                              </span>
                              <button
                                onClick={handleUnbind}
                                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 transition text-xs font-semibold"
                                title={`解除外接盘软链，切回默认虚拟盘 (当前镜像: ${dataPath})`}
                              >
                                解除外接绑定
                              </button>
                            </div>
                          ) : (
                            <span className="text-emerald-400 font-medium flex items-center space-x-1">
                              <Check className="w-3.5 h-3.5" />
                              <span>内置虚拟盘已激活</span>
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {disk.mountPoint ? (
                            <button
                              onClick={() => handleOpenBindModal(disk)}
                              className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white border border-sky-500 font-semibold transition shadow-md shadow-sky-500/20 flex items-center space-x-1.5"
                            >
                              <Layers className="w-3.5 h-3.5" />
                              <span>设为 NAS 数据盘</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleSelectDisk(disk.identifier)}
                              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-sky-600 text-slate-200 hover:text-white border border-slate-700 hover:border-sky-500 font-semibold transition"
                            >
                              选择此盘
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Section 3: Lima Managed Disks Info */}
      {managedDisks.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
          <h4 className="text-sm font-bold text-white">Lima 托管 ext4 虚拟磁盘 (Managed Disks)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {managedDisks.map((md) => (
              <div key={md.name} className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-slate-200">{md.name}</span>
                  <p className="text-[11px] text-slate-400 mt-0.5">格式: {md.format} · 容量: {(md.size / 1024 / 1024 / 1024).toFixed(0)} GiB</p>
                </div>
                <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-sky-500/20 text-sky-300">ext4</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5">
            <div>
              <h3 className="text-lg font-bold text-white">修改 Samba 共享密码</h3>
              <p className="text-xs text-slate-400 mt-1">此密码用于局域网用户 <code>macnas</code> 连接共享文件夹。</p>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="请输入 6 位以上新密码"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
                >
                  {passwordLoading ? '保存中...' : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* External Disk Bind Modal */}
      {showBindModal && bindingDisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">初始化外接 SSD 为 NAS 数据盘</h3>
                  <p className="text-xs text-slate-400">{bindingDisk.name} ({bindingDisk.deviceNode})</p>
                </div>
              </div>
              <button
                onClick={() => setShowBindModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300">
              <div className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-700/60 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">外接挂载目录:</span>
                  <span className="font-mono text-sky-300 font-semibold">{bindingDisk.mountPoint || '系统已识别，自动创建'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">可用空闲容量:</span>
                  <span className="font-mono text-white">{bindingDisk.freeSpaceString || bindingDisk.totalSizeString}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">文件系统模式:</span>
                  <span className="font-mono text-emerald-300">保持现有 APFS/ExFAT + Linux ext4 镜像容器</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  分配 NAS 数据镜像容量 (GB)
                </label>
                <div className="flex items-center space-x-3">
                  <input
                    type="number"
                    min={10}
                    max={20000}
                    value={bindSizeGB}
                    onChange={(e) => setBindSizeGB(parseInt(e.target.value) || 10)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm font-mono focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition"
                  />
                  <span className="text-sm font-semibold text-slate-400">GiB</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  采用 macOS 稀疏文件技术（Sparse Image），按需分配真实块，不会写满磁盘。
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-200 text-xs leading-relaxed space-y-1.5">
                <p className="font-bold text-sky-300">💡 为什么采用虚拟镜像容器方式？</p>
                <p>1. <strong>不格式化外接盘</strong>：盘上已有照片、备份或电影文件完好保留。</p>
                <p>2. <strong>原生 ext4 性能与稳定性</strong>：Docker 容器与 SQLite 数据库直接运行在 Linux 原生文件系统上，彻底消除网络共享文件锁死隐患。</p>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowBindModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmBind}
                disabled={bindLoading}
                className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-500/20 transition flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{bindLoading ? '正在创建镜像并绑定...' : '确认绑定为数据盘'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
