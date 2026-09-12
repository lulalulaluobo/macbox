import { appsApi } from './api/apps';
import { authApi } from './api/auth';
import { cloudApi } from './api/cloud';
import { dockerApi } from './api/docker';
import { filesApi } from './api/files';
import { sambaApi } from './api/samba';
import { storageApi } from './api/storage';
import { systemApi } from './api/system';
import { terminalApi } from './api/terminal';

export const api = {
  ...systemApi,
  ...terminalApi,
  ...storageApi,
  ...cloudApi,
  ...dockerApi,
  ...appsApi,
  ...sambaApi,
  ...filesApi,
  ...authApi,
};
