package api

func (s *Server) registerRoutes() {
	// 1. System
	s.mux.HandleFunc("GET /api/system/status", s.handleSystemStatus)
	s.mux.HandleFunc("GET /api/system/power", s.handleSystemPower)
	s.mux.HandleFunc("POST /api/system/power/toggle", s.adminOnly(s.handleSystemPowerToggle))
	s.mux.HandleFunc("GET /api/system/service", s.handleSystemServiceStatus)
	s.mux.HandleFunc("POST /api/system/service/install", s.adminOnly(s.handleSystemServiceInstall))
	s.mux.HandleFunc("POST /api/system/service/uninstall", s.adminOnly(s.handleSystemServiceUninstall))

	// 2. VM lifecycle & Specs
	s.mux.HandleFunc("POST /api/vm/start", s.adminOnly(s.handleVMStart))
	s.mux.HandleFunc("POST /api/vm/stop", s.adminOnly(s.handleVMStop))
	s.mux.HandleFunc("POST /api/vm/restart", s.adminOnly(s.handleVMRestart))
	s.mux.HandleFunc("GET /api/vm/config", s.handleVMConfigGet)
	s.mux.HandleFunc("POST /api/vm/config", s.adminOnly(s.handleVMConfigUpdate))
	s.mux.HandleFunc("GET /api/jobs", s.adminOnly(s.handleJobsList))
	s.mux.HandleFunc("GET /api/jobs/{id}", s.adminOnly(s.handleJobGet))
	s.mux.HandleFunc("POST /api/jobs/{id}/cancel", s.adminOnly(s.handleJobCancel))

	// 3. Storage
	s.mux.HandleFunc("GET /api/storage/disks", s.handleStorageDisks)
	s.mux.HandleFunc("POST /api/storage/bind", s.adminOnly(s.handleStorageBind))
	s.mux.HandleFunc("POST /api/storage/unbind", s.adminOnly(s.handleStorageUnbind))
	s.mux.HandleFunc("POST /api/storage/bind-secondary", s.adminOnly(s.handleStorageBindSecondary))
	s.mux.HandleFunc("POST /api/storage/unbind-secondary", s.adminOnly(s.handleStorageUnbindSecondary))
	s.mux.HandleFunc("GET /api/storage/mounts", s.handleStorageMountsList)
	s.mux.HandleFunc("POST /api/storage/mounts", s.adminOnly(s.handleStorageMountsAdd))
	s.mux.HandleFunc("POST /api/storage/mounts/{id}/toggle", s.adminOnly(s.handleStorageMountsToggle))
	s.mux.HandleFunc("POST /api/storage/mounts/{id}/writable", s.adminOnly(s.handleStorageMountsWritable))
	s.mux.HandleFunc("DELETE /api/storage/mounts/{id}", s.adminOnly(s.handleStorageMountsDelete))

	// 4. Docker Overview & Containers
	s.mux.HandleFunc("GET /api/docker/overview", s.handleDockerOverview)
	s.mux.HandleFunc("GET /api/docker/containers", s.handleDockerContainers)
	s.mux.HandleFunc("POST /api/docker/containers/{id}/action", s.adminOnly(s.handleDockerContainerAction))
	s.mux.HandleFunc("DELETE /api/docker/containers/{id}", s.adminOnly(s.handleDockerRemoveContainer))
	s.mux.HandleFunc("GET /api/docker/containers/{id}/logs", s.adminOnly(s.handleDockerLogs))

	// Docker Images
	s.mux.HandleFunc("GET /api/docker/images", s.handleDockerImages)
	s.mux.HandleFunc("POST /api/docker/images/pull", s.adminOnly(s.handleDockerPullImage))
	s.mux.HandleFunc("DELETE /api/docker/images/{id}", s.adminOnly(s.handleDockerRemoveImage))
	s.mux.HandleFunc("POST /api/docker/images/prune", s.adminOnly(s.handleDockerPruneImages))

	// Docker Compose
	s.mux.HandleFunc("GET /api/docker/compose", s.handleDockerComposeList)
	s.mux.HandleFunc("GET /api/docker/compose/{name}", s.adminOnly(s.handleDockerComposeGetYaml))
	s.mux.HandleFunc("POST /api/docker/compose/deploy", s.adminOnly(s.handleDockerComposeDeploy))
	s.mux.HandleFunc("POST /api/docker/compose/{name}/action", s.adminOnly(s.handleDockerComposeAction))
	s.mux.HandleFunc("DELETE /api/docker/compose/{name}", s.adminOnly(s.handleDockerComposeDelete))

	// Docker Networks & Mirrors
	s.mux.HandleFunc("GET /api/docker/networks", s.handleDockerNetworks)
	s.mux.HandleFunc("GET /api/docker/mirrors", s.handleDockerGetMirrors)
	s.mux.HandleFunc("POST /api/docker/mirrors", s.adminOnly(s.handleDockerSetMirrors))

	// 5. Apps
	s.mux.HandleFunc("GET /api/apps", s.handleAppsList)
	s.mux.HandleFunc("GET /api/apps/{id}/config", s.adminOnly(s.handleAppGetConfig))
	s.mux.HandleFunc("POST /api/apps/{id}/install", s.adminOnly(s.handleAppInstall))
	s.mux.HandleFunc("POST /api/apps/{id}/install/custom", s.adminOnly(s.handleAppInstallCustomStream))
	s.mux.HandleFunc("POST /api/apps/custom", s.adminOnly(s.handleAppCustomAdd))
	s.mux.HandleFunc("DELETE /api/apps/custom/{id}", s.adminOnly(s.handleAppCustomDelete))
	s.mux.HandleFunc("POST /api/apps/sync", s.adminOnly(s.handleAppStoreSync))
	s.mux.HandleFunc("POST /api/apps/{id}/start", s.adminOnly(s.handleAppStart))
	s.mux.HandleFunc("POST /api/apps/{id}/stop", s.adminOnly(s.handleAppStop))
	s.mux.HandleFunc("POST /api/apps/{id}/restart", s.adminOnly(s.handleAppRestart))
	s.mux.HandleFunc("POST /api/apps/{id}/uninstall", s.adminOnly(s.handleAppUninstall))
	s.mux.HandleFunc("GET /api/apps/{id}/logs", s.adminOnly(s.handleAppLogs))

	// 6. Samba
	s.mux.HandleFunc("GET /api/samba/status", s.handleSambaStatus)
	s.mux.HandleFunc("POST /api/samba/shares", s.adminOnly(s.handleSambaShareAddOrUpdate))
	s.mux.HandleFunc("PUT /api/samba/shares/{id}", s.adminOnly(s.handleSambaShareAddOrUpdate))
	s.mux.HandleFunc("POST /api/samba/shares/{id}/toggle", s.adminOnly(s.handleSambaShareToggle))
	s.mux.HandleFunc("DELETE /api/samba/shares/{id}", s.adminOnly(s.handleSambaShareDelete))
	s.mux.HandleFunc("POST /api/samba/service/toggle", s.adminOnly(s.handleSambaServiceToggle))
	s.mux.HandleFunc("POST /api/samba/service/restart", s.adminOnly(s.handleSambaServiceRestart))
	s.mux.HandleFunc("POST /api/samba/password", s.adminOnly(s.handleSambaPassword))

	// 7. Web Terminal & File System
	s.mux.HandleFunc("GET /api/terminal/ws", s.adminOnly(s.handleTerminalWS))
	s.mux.HandleFunc("GET /api/terminal/files", s.handleTerminalFilesList)
	s.mux.HandleFunc("GET /api/terminal/files/read", s.handleTerminalFileRead)
	s.mux.HandleFunc("POST /api/terminal/files/write", s.adminOnly(s.handleTerminalFileWrite))
	s.mux.HandleFunc("POST /api/terminal/files/mkdir", s.adminOnly(s.handleTerminalFileMkdir))
	s.mux.HandleFunc("POST /api/terminal/files/upload", s.adminOnly(s.handleTerminalFileUpload))
	s.mux.HandleFunc("POST /api/terminal/files/rename", s.adminOnly(s.handleTerminalFileRename))
	s.mux.HandleFunc("DELETE /api/terminal/files", s.adminOnly(s.handleTerminalFileDelete))
	s.mux.HandleFunc("GET /api/terminal/files/download", s.handleTerminalFileDownload)
	s.mux.HandleFunc("GET /api/terminal/files/raw", s.handleTerminalFileRaw)
	s.mux.HandleFunc("POST /api/terminal/files/copy", s.adminOnly(s.handleTerminalFilesCopy))
	s.mux.HandleFunc("POST /api/terminal/files/move", s.adminOnly(s.handleTerminalFilesMove))
	s.mux.HandleFunc("POST /api/terminal/files/trash", s.adminOnly(s.handleTerminalFilesTrash))
	s.mux.HandleFunc("GET /api/terminal/files/trash", s.handleTerminalFilesTrashList)
	s.mux.HandleFunc("POST /api/terminal/files/restore", s.adminOnly(s.handleTerminalFilesRestore))
	s.mux.HandleFunc("POST /api/terminal/files/trash/delete", s.adminOnly(s.handleTerminalFilesTrashDelete))
	s.mux.HandleFunc("POST /api/terminal/files/empty-trash", s.adminOnly(s.handleTerminalFilesEmptyTrash))

	// 8. System Security, Users & SSH
	s.mux.HandleFunc("GET /api/system/users", s.adminOnly(s.handleListUsers))
	s.mux.HandleFunc("POST /api/system/users", s.adminOnly(s.handleCreateUser))
	s.mux.HandleFunc("POST /api/system/users/{username}/password", s.adminOnly(s.handleUpdateUserPassword))
	s.mux.HandleFunc("DELETE /api/system/users/{username}", s.adminOnly(s.handleDeleteUser))
	s.mux.HandleFunc("POST /api/system/root/password", s.adminOnly(s.handleUpdateRootPassword))
	s.mux.HandleFunc("GET /api/system/ssh", s.adminOnly(s.handleGetSSHConfig))
	s.mux.HandleFunc("POST /api/system/ssh", s.adminOnly(s.handleUpdateSSHConfig))
	s.mux.HandleFunc("POST /api/system/ssh/toggle", s.adminOnly(s.handleToggleSSH))
	s.mux.HandleFunc("POST /api/system/ssh/keys/generate", s.adminOnly(s.handleGenerateSSHRootKey))
	s.mux.HandleFunc("GET /api/system/ssh/keys", s.adminOnly(s.handleGetSSHAuthorizedKeys))
	s.mux.HandleFunc("POST /api/system/ssh/keys/add", s.adminOnly(s.handleAddSSHAuthorizedKey))
	s.mux.HandleFunc("DELETE /api/system/ssh/keys", s.adminOnly(s.handleClearSSHAuthorizedKeys))
	s.mux.HandleFunc("GET /api/system/terminal/settings", s.handleGetTerminalSettings)
	s.mux.HandleFunc("POST /api/system/terminal/settings", s.adminOnly(s.handleUpdateTerminalSettings))

	// 9. Web Console Authentication & User Management
	s.mux.HandleFunc("POST /api/auth/login", s.handleAuthLogin)
	s.mux.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	s.mux.HandleFunc("POST /api/auth/setup", s.handleAuthSetup)
	s.mux.HandleFunc("POST /api/auth/logout", s.handleAuthLogout)
	s.mux.HandleFunc("GET /api/auth/me", s.handleAuthMe)
	s.mux.HandleFunc("POST /api/auth/change-pwd", s.handleAuthChangePassword)
	s.mux.HandleFunc("GET /api/auth/users", s.handleAuthListUsers)
	s.mux.HandleFunc("POST /api/auth/users", s.handleAuthCreateUser)
	s.mux.HandleFunc("PUT /api/auth/users/{id}", s.handleAuthUpdateUser)
	s.mux.HandleFunc("DELETE /api/auth/users/{id}", s.handleAuthDeleteUser)
}
