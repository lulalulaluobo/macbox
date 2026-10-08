import React from 'react';
import { CheckCircle2 } from 'lucide-react';

interface AppInstallResultProps {
  webAccessUrl: string;
}

export const AppInstallResult: React.FC<AppInstallResultProps> = ({ webAccessUrl }) => (
  <div className="space-y-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 p-4 text-xs text-emerald-300 shadow-lg">
    <div className="flex items-center space-x-2 text-sm font-bold"><CheckCircle2 className="h-5 w-5 text-emerald-400" /><span>应用已安装完成</span></div>
    <p className="text-xs text-emerald-200/90">{webAccessUrl ? "应用网址" : "系统没有地址，请到网络连接中设置"} {webAccessUrl && <a href={webAccessUrl} target="_blank" rel="noreferrer" className="ml-1 font-mono font-bold text-white underline">{webAccessUrl}</a>}</p>
    <p className="text-[11px] text-emerald-200/75">请先查看或复制安装记录。<br />其中可能包含首次登录信息。<br />确认保存后再关闭窗口。</p>
  </div>
);
