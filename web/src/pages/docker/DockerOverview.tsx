import React, { useEffect, useState } from 'react';
import { Activity, Box, Cpu, Disc3, Layers, MemoryStick, Network, RefreshCw } from 'lucide-react';
import { DockerOverview as DockerOverviewType } from '../../types';
import { api } from '../../api';

type DockerTarget = 'containers' | 'compose' | 'images' | 'networks';

interface DockerOverviewProps {
  onNavigateTab: (tab: DockerTarget) => void;
}

export const DockerOverview: React.FC<DockerOverviewProps> = ({ onNavigateTab }) => {
  const [data, setData] = useState<DockerOverviewType | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = async () => {
    try {
      setData(await api.getDockerOverview());
    } catch {
      // Keep the last available snapshot.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
    const poll = () => { if (!document.hidden) fetchOverview(); };
    const timer = window.setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);

  const ready = Boolean(data?.dockerReady);
  const launches = [
    { id: 'containers' as const, label: '容器', value: `${data?.containersRunning || 0}/${data?.containersTotal || 0}`, icon: Box, tone: 'bg-sky-50 text-sky-500 dark:bg-sky-500/10' },
    { id: 'compose' as const, label: '编排', value: `${data?.projectsRunning || 0}/${data?.projectsTotal || 0}`, icon: Layers, tone: 'bg-violet-50 text-violet-500 dark:bg-violet-500/10' },
    { id: 'images' as const, label: '镜像', value: `${data?.imagesTotal || 0}`, icon: Disc3, tone: 'bg-amber-50 text-amber-500 dark:bg-amber-500/10' },
    { id: 'networks' as const, label: '网络', value: '设置', icon: Network, tone: 'bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10' },
  ];
  const metrics = [
    { label: 'CPU', value: `${(data?.cpuPerc || 0).toFixed(1)}%`, progress: data?.cpuPerc || 0, icon: Cpu, color: 'text-sky-500', bar: 'bg-sky-500' },
    { label: '内存', value: `${(data?.memPerc || 0).toFixed(1)}%`, progress: data?.memPerc || 0, icon: MemoryStick, color: 'text-violet-500', bar: 'bg-violet-500' },
    { label: '网络', value: `${((data?.netRxKb || 0) + (data?.netTxKb || 0)).toFixed(1)} KB/s`, progress: Math.min(((data?.netRxKb || 0) + (data?.netTxKb || 0)) / 10, 100), icon: Activity, color: 'text-emerald-500', bar: 'bg-emerald-500' },
  ];

  return (
    <div className="flex min-h-full flex-col gap-2.5">
      <section className="flex min-h-[72px] items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${ready ? 'bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10' : 'bg-amber-50 text-amber-500 dark:bg-amber-500/10'}`}><Box className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><h2 className="text-base font-black text-slate-900 dark:text-white">Docker Engine</h2><div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><span className={`h-2 w-2 rounded-full ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`} /><span>{ready ? '运行中' : '未就绪'}</span>{data?.dockerVersion && <span className="truncate">· v{data.dockerVersion}</span>}</div></div>
        <button type="button" onClick={fetchOverview} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-300" aria-label="刷新 Docker 状态"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </section>

      <section className="rounded-[22px] border border-slate-200/80 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/75 sm:p-4">
        <div className="grid grid-cols-4 gap-2">
          {launches.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" onClick={() => onNavigateTab(item.id)} className="flex min-w-0 flex-col items-center rounded-2xl px-1 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"><span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${item.tone}`}><Icon className="h-5 w-5" /></span><span className="mt-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">{item.label}</span><span className="mt-0.5 text-[9px] text-slate-400">{item.value}</span></button>;
          })}
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2.5">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return <div key={metric.label} className="min-w-0 rounded-[20px] border border-slate-200/80 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/75 sm:p-4"><div className="flex items-center justify-between gap-1"><span className="text-[10px] font-bold text-slate-500 sm:text-xs">{metric.label}</span><Icon className={`h-4 w-4 ${metric.color}`} /></div><p className="mt-2 truncate text-lg font-black text-slate-900 dark:text-white sm:text-xl">{metric.value}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${metric.bar}`} style={{ width: `${Math.min(metric.progress, 100)}%` }} /></div></div>;
        })}
      </section>
    </div>
  );
};
