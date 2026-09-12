import React from 'react';
import {
  Activity,
  Box,
  Cloud,
  Code2,
  Database,
  Download,
  Film,
  Folder,
  Globe,
  HardDrive,
  Home,
  Image,
  Layers,
  Music,
  Network,
  Radio,
  Server,
  Shield,
  Terminal,
  Wrench,
} from 'lucide-react';

type IconComponent = React.ComponentType<{ className?: string }>;

export const DOCKER_SERVICE_ICON_OPTIONS: Array<{ value: string; label: string; Icon: IconComponent }> = [
  { value: 'box', label: '容器', Icon: Box },
  { value: 'server', label: '服务器', Icon: Server },
  { value: 'cloud', label: '云服务', Icon: Cloud },
  { value: 'database', label: '数据库', Icon: Database },
  { value: 'download', label: '下载', Icon: Download },
  { value: 'film', label: '影视', Icon: Film },
  { value: 'folder', label: '文件', Icon: Folder },
  { value: 'hard-drive', label: '硬盘', Icon: HardDrive },
  { value: 'image', label: '图片', Icon: Image },
  { value: 'layers', label: '编排', Icon: Layers },
  { value: 'music', label: '音乐', Icon: Music },
  { value: 'network', label: '网络', Icon: Network },
  { value: 'radio', label: '广播', Icon: Radio },
  { value: 'shield', label: '安全', Icon: Shield },
  { value: 'activity', label: '监控', Icon: Activity },
  { value: 'terminal', label: '终端', Icon: Terminal },
  { value: 'wrench', label: '工具', Icon: Wrench },
  { value: 'globe', label: '网站', Icon: Globe },
  { value: 'home', label: '家居', Icon: Home },
  { value: 'code', label: '代码', Icon: Code2 },
];

export const DockerServiceIcon: React.FC<{ name?: string; className?: string }> = ({ name = 'box', className = 'h-5 w-5' }) => {
  const option = DOCKER_SERVICE_ICON_OPTIONS.find((item) => item.value === name) || DOCKER_SERVICE_ICON_OPTIONS[0];
  return <option.Icon className={className} />;
};
