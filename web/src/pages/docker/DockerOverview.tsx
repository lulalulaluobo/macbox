import React, { useState, useEffect } from 'react';
import { CheckCircle2, Layers, Disc3, HardDrive, Cpu, Activity, ArrowDown, ArrowUp, RefreshCw, Box } from 'lucide-react';
import { DockerOverview as DockerOverviewType } from '../../types';
import { api } from '../../api';

interface Point {
  time: string;
  value: number;
}

export const DockerOverview: React.FC = () => {
  const [data, setData] = useState<DockerOverviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [cpuHistory, setCpuHistory] = useState<Point[]>([]);
  const [memHistory, setMemHistory] = useState<Point[]>([]);
  const [netRxHistory, setNetRxHistory] = useState<Point[]>([]);
  const [netTxHistory, setNetTxHistory] = useState<Point[]>([]);
  const [netDirection, setNetDirection] = useState<'rx' | 'tx'>('rx');

  const fetchOverview = async () => {
    try {
      const res = await api.getDockerOverview();
      setData(res);

      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setCpuHistory(prev => [...prev.slice(-24), { time: now, value: res.cpuPerc || 0 }]);
      setMemHistory(prev => [...prev.slice(-24), { time: now, value: res.memPerc || 0 }]);
      setNetRxHistory(prev => [...prev.slice(-24), { time: now, value: res.netRxKb || 0 }]);
      setNetTxHistory(prev => [...prev.slice(-24), { time: now, value: res.netTxKb || 0 }]);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 3500);
    return () => clearInterval(interval);
  }, []);

  // SVG Chart component
  const renderChart = (points: Point[], color: string, fillColor: string, maxVal = 100, unit = '%') => {
    if (points.length < 2) {
      return (
        <div className="h-36 flex items-center justify-center text-xs text-slate-500">
          <Activity className="w-4 h-4 mr-2 animate-pulse" /> 正在收集监控采样数据...
        </div>
      );
    }

    const width = 360;
    const height = 110;
    const padding = 10;
    const effectiveWidth = width - padding * 2;
    const effectiveHeight = height - padding * 2;

    const dynamicMax = Math.max(maxVal, ...points.map(p => p.value * 1.2), 1);

    const coords = points.map((p, i) => {
      const x = padding + (i / (points.length - 1)) * effectiveWidth;
      const y = height - padding - (Math.min(p.value, dynamicMax) / dynamicMax) * effectiveHeight;
      return { x, y };
    });

    const pathData = coords.reduce((acc, c, i) => (i === 0 ? `M ${c.x},${c.y}` : `${acc} L ${c.x},${c.y}`), '');
    const areaData = `${pathData} L ${coords[coords.length - 1].x},${height - padding} L ${coords[0].x},${height - padding} Z`;

    const latestVal = points[points.length - 1]?.value.toFixed(1) ?? '0';

    return (
      <div className="relative">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-400">实时当前值:</span>
          <span className="font-mono font-bold text-white text-sm">
            {latestVal} {unit}
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28 overflow-visible">
          <defs>
            <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillColor} stopOpacity="0.35" />
              <stop offset="100%" stopColor={fillColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          {/* Grid lines */}
          <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#334155" strokeDasharray="3,3" strokeOpacity="0.4" />
          <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#334155" strokeDasharray="3,3" strokeOpacity="0.4" />
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#334155" strokeOpacity="0.8" />

          {/* Area */}
          <path d={areaData} fill={`url(#grad-${color})`} />
          {/* Line */}
          <path d={pathData} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* Latest Point */}
          {coords.length > 0 && (
            <circle
              cx={coords[coords.length - 1].x}
              cy={coords[coords.length - 1].y}
              r="4"
              fill={color}
              className="animate-ping origin-center"
              style={{ transformOrigin: `${coords[coords.length - 1].x}px ${coords[coords.length - 1].y}px` }}
            />
          )}
        </svg>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Summary */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center space-x-2">
            <span>Docker 概览</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
              Engine v{data?.dockerVersion || '29.8'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">监控由原生虚拟机驱动的 Docker 服务状态与容器资源指标</p>
        </div>
        <button
          onClick={fetchOverview}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 hover:text-white transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>刷新</span>
        </button>
      </div>

      {/* Two Main Cards: Health & Service Controls (Exact FnOS Alignment) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card 1: Health Status Card */}
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800/90 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center space-x-2.5">
                <span className="text-2xl font-black text-white">健康</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                  正常运行
                </span>
              </div>
              <p className="text-xs text-slate-400">{data?.healthMessage || '所有服务运行状态健康'}</p>
            </div>

            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-inner">
              <CheckCircle2 className="w-9 h-9" />
            </div>
          </div>

          <div className="mt-8 pt-5 border-t border-slate-800/80 grid grid-cols-3 gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center text-slate-400 space-x-1">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>Compose 项目</span>
              </div>
              <div className="text-base font-bold text-white font-mono">
                {data?.projectsRunning ?? 0}{' '}
                <span className="text-xs text-slate-400 font-normal">/ {data?.projectsTotal ?? 0} 个</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center text-slate-400 space-x-1">
                <Disc3 className="w-3.5 h-3.5 text-amber-400" />
                <span>本地镜像</span>
              </div>
              <div className="text-base font-bold text-white font-mono">
                {data?.imagesTotal ?? 0}{' '}
                <span className="text-xs text-slate-400 font-normal">({data?.imagesInUse ?? 0} 个使用中)</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center text-slate-400 space-x-1">
                <Box className="w-3.5 h-3.5 text-sky-400" />
                <span>容器实例</span>
              </div>
              <div className="text-base font-bold text-white font-mono">
                {data?.containersRunning ?? 0}{' '}
                <span className="text-xs text-slate-400 font-normal">/ {data?.containersTotal ?? 0} 运行</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 2: Docker Service Settings Card */}
        <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800/90 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Docker 引擎服务</h3>
                <p className="text-xs text-slate-400 mt-0.5">控制底层守护进程生命周期与存储空间挂载</p>
              </div>
              {/* Toggle Switch */}
              <div className="flex items-center space-x-2">
                <span className="text-xs text-emerald-400 font-medium">已就绪</span>
                <div className="w-11 h-6 bg-emerald-500 rounded-full p-0.5 flex items-center justify-end cursor-default shadow-sm">
                  <div className="w-5 h-5 bg-white rounded-full shadow-md" />
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-3.5">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/50 border border-slate-800 text-xs">
                <div className="flex items-center space-x-2 text-slate-300">
                  <HardDrive className="w-4 h-4 text-sky-400" />
                  <span>存储空间位置</span>
                </div>
                <div className="flex items-center space-x-2 font-mono text-slate-200">
                  <span className="px-2 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 text-[11px]">
                    {data?.storageLocation || '存储空间 1 (MacNAS 虚拟专有卷)'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-800/50 border border-slate-800 text-xs">
                <div className="flex items-center space-x-2 text-slate-300">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>虚拟机随系统开机自动启动</span>
                </div>
                <div className="w-9 h-5 bg-emerald-500 rounded-full p-0.5 flex items-center justify-end cursor-default">
                  <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>容器虚拟网段: 172.17.0.0/16</span>
            <span className="text-emerald-400 font-medium">Socket 直通健康</span>
          </div>
        </div>
      </div>

      {/* Information Monitoring Charts (Exact FnOS 3-column Realtime Metric Layout) */}
      <div className="p-6 rounded-3xl bg-slate-900/80 border border-slate-800/90 shadow-xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">信息监控</h3>
            <p className="text-xs text-slate-400 mt-0.5">所有容器与 Compose 服务的综合资源负载走势</p>
          </div>
          <div className="flex items-center space-x-4 text-xs font-mono">
            <span className="flex items-center space-x-1 text-sky-400">
              <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
              <span>CPU</span>
            </span>
            <span className="flex items-center space-x-1 text-indigo-400">
              <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
              <span>内存</span>
            </span>
            <span className="flex items-center space-x-1 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              <span>网络</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
          {/* CPU Chart */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
              <Cpu className="w-4 h-4 text-sky-400" />
              <span>CPU 使用率 (%)</span>
            </div>
            {renderChart(cpuHistory, '#38bdf8', '#0284c7', 100, '%')}
          </div>

          {/* Memory Chart */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <div className="flex items-center space-x-2">
                <HardDrive className="w-4 h-4 text-indigo-400" />
                <span>内存使用率 (%)</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {(data?.memUsageMb ?? 0).toFixed(0)} MB / {(data?.memTotalMb ?? 0).toFixed(0)} MB
              </span>
            </div>
            {renderChart(memHistory, '#818cf8', '#6366f1', 100, '%')}
          </div>

          {/* Network Chart */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>网络实时流量</span>
              </div>
              <div className="flex items-center space-x-2 text-[11px] font-mono">
                <button
                  type="button"
                  onClick={() => setNetDirection('rx')}
                  className={`text-emerald-400 flex items-center px-1.5 py-0.5 rounded transition ${
                    netDirection === 'rx' ? 'bg-emerald-500/20 font-bold border border-emerald-500/30' : 'opacity-70'
                  }`}
                >
                  <ArrowDown className="w-3 h-3 mr-0.5" />
                  {(data?.netRxKb ?? 0).toFixed(1)} KB/s
                </button>
                <button
                  type="button"
                  onClick={() => setNetDirection('tx')}
                  className={`text-sky-400 flex items-center px-1.5 py-0.5 rounded transition ${
                    netDirection === 'tx' ? 'bg-sky-500/20 font-bold border border-sky-500/30' : 'opacity-70'
                  }`}
                >
                  <ArrowUp className="w-3 h-3 mr-0.5" />
                  {(data?.netTxKb ?? 0).toFixed(1)} KB/s
                </button>
              </div>
            </div>
            {netDirection === 'rx'
              ? renderChart(netRxHistory, '#10b981', '#059669', 50, 'KB/s (下载)')
              : renderChart(netTxHistory, '#38bdf8', '#0284c7', 50, 'KB/s (上传)')}
          </div>
        </div>
      </div>
    </div>
  );
};
