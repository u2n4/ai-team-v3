'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiTeamV3', {
  getDashboardState: () => ipcRenderer.invoke('dashboard:state'),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  openProvider: (providerId, approval) => ipcRenderer.invoke('provider:open', providerId, approval)
});
