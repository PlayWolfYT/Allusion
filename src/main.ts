import {
  app,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  Tray,
} from 'electron';
import path from 'path';
import fse from 'fs-extra';
import { autoUpdater, UpdateInfo } from 'electron-updater';
import TrayIcon from '../resources/logo/png/full-color/allusion-logomark-fc-256x256.png';
import AppIcon from '../resources/logo/png/full-color/allusion-logomark-fc-512x512.png';
import TrayIconMac from '../resources/logo/png/black/allusionTemplate@2x.png'; // filename convention: https://www.electronjs.org/docs/api/native-image#template-image
import ClipServer, { IImportItem } from './clipper/server';
import { isDev } from './config';
import { ITag, ROOT_TAG_ID } from './entities/Tag';
import { MainMessenger, WindowSystemButtonPress } from './Messaging';

let mainWindow: BrowserWindow | null;
let previewWindow: BrowserWindow | null;
let tray: Tray | null;
let clipServer: ClipServer | null;

const windowStateFilePath = path.join(app.getPath('userData'), 'windowState.json');

const isMac = process.platform === 'darwin';

/** Returns whether main window is open - so whether files can be immediately imported */
const importExternalImage = async (item: IImportItem) => {
  if (mainWindow) {
    MainMessenger.sendImportExternalImage(mainWindow.webContents, { item });
    return true;
  }
  return false;
};

const addTagsToFile = async (item: IImportItem) => {
  if (mainWindow) {
    MainMessenger.sendAddTagsToFile(mainWindow.webContents, { item });
    return true;
  }
  return false;
};

const getTags = async (): Promise<ITag[]> => {
  if (mainWindow) {
    const { tags } = await MainMessenger.getTags(mainWindow.webContents);
    return tags.filter((t) => t.id !== ROOT_TAG_ID);
  }
  return [];
};

// Based on https://github.com/electron/electron/issues/526
const getWindowBounds = (): BrowserWindowConstructorOptions => {
  const options: BrowserWindowConstructorOptions = {};
  if (fse.existsSync(windowStateFilePath)) {
    const bounds = fse.readJSONSync(windowStateFilePath);

    if (bounds) {
      const area = screen.getDisplayMatching(bounds).workArea;
      // If the saved position still valid (the window is entirely inside the display area), use it.
      if (
        bounds.x >= area.x &&
        bounds.y >= area.y &&
        bounds.x + bounds.width <= area.x + area.width &&
        bounds.y + bounds.height <= area.y + area.height
      ) {
        options.x = bounds.x;
        options.y = bounds.y;
      }
      // If the saved size is still valid, use it.
      if (bounds.width <= area.width || bounds.height <= area.height) {
        options.width = bounds.width;
        options.height = bounds.height;
      }
    }
  }
  return options;
};

// Save window position and bounds: https://github.com/electron/electron/issues/526
let saveBoundsTimeout: ReturnType<typeof setTimeout> | null = null;
function saveBoundsSoon() {
  if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
  saveBoundsTimeout = setTimeout(() => {
    saveBoundsTimeout = null;
    const bounds = mainWindow?.getNormalBounds();
    fse.writeFileSync(windowStateFilePath, JSON.stringify(bounds, null, 2));
  }, 1000);
}

let initialize = () => {
  console.error('Placeholder function. App was not properly initialized!');
};

function createTrayMenu() {
  if (!tray || tray.isDestroyed()) {
    tray = new Tray(`${__dirname}/${isMac ? TrayIconMac : TrayIcon}`);
    const trayMenu = Menu.buildFromTemplate([
      {
        label: 'Open',
        type: 'normal',
        click: () => mainWindow?.focus() ?? initialize(),
      },
      {
        label: 'Quit',
        click: () => process.exit(0),
      },
    ]);
    tray.setContextMenu(trayMenu);
    tray.setToolTip('Allusion - Your Visual Library');
    tray.on('click', () => mainWindow?.focus() ?? initialize());
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const mainOptions: BrowserWindowConstructorOptions = {
    titleBarStyle: 'hidden',
    // Disable native frame: we use a custom titlebar for all platforms: a unique one for MacOS, and one for windows/linux
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      // window.open should open a normal window like in a browser, not an electron BrowserWindowProxy
      nativeWindowOpen: true,
      nodeIntegrationInSubFrames: true,
    },
    width,
    height,
    minWidth: 240,
    minHeight: 64,
    icon: `${__dirname}/${AppIcon}`,
    // Should be same as body background: Only for split second before css is loaded
    backgroundColor: '#1c1e23',
    title: 'Allusion',
    show: false, // only show once initial loading is finished
    // Remember window size and position
    ...getWindowBounds(),
  };

  // Create the browser window.
  mainWindow = new BrowserWindow(mainOptions);
  mainWindow.on('ready-to-show', () => mainWindow?.show());

  // Customize new window opening
  // https://www.electronjs.org/docs/api/window-open
  mainWindow.webContents.on('new-window', (event, _url, frameName, _disposition, options) => {
    if (mainWindow === null || mainWindow?.isDestroyed()) {
      return;
    }

    const windowTitles: { [key: string]: string } = {
      settings: 'Settings',
      'help-center': 'Help Center',
      about: 'About',
    };
    if (!(frameName in windowTitles)) return;

    // Note: For pop-out windows, the native frame is enabled
    // but it appears to not work on OSX, likely due to setting the parent window

    event.preventDefault();
    // https://www.electronjs.org/docs/api/browser-window#class-browserwindow
    const additionalOptions: Electron.BrowserWindowConstructorOptions = {
      parent: mainWindow,
      width: 680,
      height: 480,
      title: `${windowTitles[frameName]} • Allusion`,
      frame: true,
      titleBarStyle: 'default',
    };
    Object.assign(options, additionalOptions);
    const childWindow = new BrowserWindow(options);
    childWindow.center(); // "center" in additionalOptions doesn't work :/
    childWindow.setMenu(null); // no toolbar needed
    event.newGuest = childWindow;

    if (isDev()) {
      childWindow.webContents.openDevTools();
    }

    mainWindow.webContents.once('will-navigate', () => {
      if (!childWindow?.isDestroyed()) {
        childWindow.close(); // close when main window is reloaded
      }
    });
  });

  mainWindow.addListener(
    'enter-full-screen',
    () => mainWindow && MainMessenger.fullscreenChanged(mainWindow.webContents, true),
  );

  mainWindow.addListener(
    'leave-full-screen',
    () => mainWindow && MainMessenger.fullscreenChanged(mainWindow.webContents, false),
  );

  mainWindow.addListener('resize', saveBoundsSoon);
  mainWindow.addListener('move', saveBoundsSoon);

  let menu = null;

  // Mac App menu - used for styling so shortcuts work
  // https://livebook.manning.com/book/cross-platform-desktop-applications/chapter-9/78

  // Create our menu entries so that we can use MAC shortcuts
  const menuBar: Electron.MenuItemConstructorOptions[] = [];

  menuBar.push({
    label: 'Allusion',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services', submenu: [] },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click: () => process.exit(0),
      },
    ],
  });

  menuBar.push({
    label: 'Edit',
    submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }],
  });

  menuBar.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      {
        label: 'Actual Size',
        accelerator: 'CommandOrControl+0',
        click: (_, browserWindow) => {
          if (browserWindow) {
            browserWindow.webContents.zoomFactor = 1;
          }
        },
      },
      {
        label: 'Zoom In',
        // TODO: Fix by using custom solution...
        accelerator: 'CommandOrControl+=',
        click: (_, browserWindow) => {
          if (browserWindow) {
            browserWindow.webContents.zoomFactor += 0.1;
          }
        },
      },
      {
        label: 'Zoom Out',
        accelerator: 'CommandOrControl+-',
        click: (_, browserWindow) => {
          if (browserWindow) {
            browserWindow.webContents.zoomFactor -= 0.1;
          }
        },
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  menu = Menu.buildFromTemplate(menuBar);

  Menu.setApplicationMenu(menu);

  // and load the index.html of the app.
  mainWindow.loadURL(`file://${__dirname}/index.html`);

  // Open the DevTools if in dev mode.
  if (isDev()) {
    mainWindow.webContents.openDevTools();
  }

  // Emitted when the window is closed.
  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.close();
    }
  });

  mainWindow.on('maximize', () => {
    if (mainWindow !== null) {
      MainMessenger.maximize(mainWindow.webContents);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow !== null) {
      MainMessenger.unmaximize(mainWindow.webContents);
    }
  });

  if (!clipServer) {
    clipServer = new ClipServer(importExternalImage, addTagsToFile, getTags);
  }

  // System tray icon: Always show on Mac, or other platforms when the app is running in the background
  // Useful for browser extension, so it will work even when the window is closed
  if (isMac || clipServer.isRunInBackgroundEnabled()) {
    createTrayMenu();
  }

  // Import images that were added while the window was closed
  MainMessenger.onceInitialized().then(async () => {
    if (clipServer === null || mainWindow === null) {
      return;
    }
    const importItems = await clipServer.getImportQueue();
    await Promise.all(importItems.map(importExternalImage));
    clipServer.clearImportQueue();
  });
}

function createPreviewWindow() {
  // Get display where main window is located
  let display = screen.getPrimaryDisplay();
  if (mainWindow) {
    const winBounds = mainWindow.getBounds();
    display = screen.getDisplayNearestPoint({ x: winBounds.x, y: winBounds.y });
  }

  previewWindow = new BrowserWindow({
    webPreferences: {
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
    },
    minWidth: 224,
    minHeight: 224,
    height: (display.size.height * 3) / 4, // preview window is is sized relative to screen resolution by default
    width: (display.size.width * 3) / 4,
    icon: `${__dirname}/${AppIcon}`,
    // Should be same as body background: Only for split second before css is loaded
    backgroundColor: '#14181a',
    title: 'Allusion Quick View',
    show: false, // invis by default
  });
  previewWindow.setMenuBarVisibility(false);
  previewWindow.loadURL(`file://${__dirname}/index.html?preview=true`);
  previewWindow.on('close', (e) => {
    // Prevent close, hide the window instead, for faster launch next time
    if (mainWindow) {
      e.preventDefault();
      MainMessenger.sendClosedPreviewWindow(mainWindow.webContents);
      mainWindow.focus();
    }
    if (previewWindow) {
      previewWindow.hide();
    }
  });
  return previewWindow;
}

initialize = () => {
  createWindow();
  createPreviewWindow();

  // autoUpdater.checkForUpdatesAndNotify();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', initialize);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (!(clipServer && clipServer.isRunInBackgroundEnabled())) {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow();
  }
});

// Auto-updates: using electron-builders autoUpdater: https://www.electron.build/auto-update#quick-setup-guide
// How it should go:
// - Auto check for updates on startup (toggleable in settings) -> show toast message if update available
// - Option to check for updates in settings
// - Only download and install when user agrees
autoUpdater.autoDownload = false;
let hasCheckedForUpdateOnStartup = false;
if (isDev()) {
  autoUpdater.updateConfigPath = path.join(__dirname, '..', 'dev-app-update.yml');
}

autoUpdater.on('error', (error) => {
  dialog.showErrorBox('Error: ', error == null ? 'unknown' : (error.stack || error).toString());
});

autoUpdater.on('update-available', async (update: { info: UpdateInfo }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const dialogResult = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Found Updates',
    message: `Update available: ${update.info.releaseName || update.info.version} (${
      update.info.releaseDate
    })\n${update.info?.releaseNotes}, do you want update now?`,
    buttons: ['Sure', 'No', 'Open release page'],
  });

  if (dialogResult.response === 0) {
    autoUpdater.downloadUpdate();
  } else if (dialogResult.response === 2) {
    shell.openExternal('https://github.com/allusion-app/Allusion/releases/latest');
  }
});

autoUpdater.on('update-not-available', () => {
  if (!hasCheckedForUpdateOnStartup) {
    // don't show a dialog if the update check was triggered automatically on start-up
    hasCheckedForUpdateOnStartup = true;
    return;
  }
  // Could also show this as a toast!
  if (!mainWindow || mainWindow.isDestroyed()) return;
  dialog.showMessageBox(mainWindow, {
    title: 'No Update Available',
    message: `Current version is up-to-date (v${getVersion()})!`,
  });
});

autoUpdater.on('update-downloaded', async () => {
  await dialog.showMessageBox({
    title: 'Install Updates',
    message: 'Updates downloaded, Allusion will restart...',
  });
  setImmediate(() => autoUpdater.quitAndInstall());
});

// check for updates on startup.
// TODO: Make this disableable
autoUpdater.checkForUpdates();

// Messaging: Sending and receiving messages between the main and renderer process //
/////////////////////////////////////////////////////////////////////////////////////
MainMessenger.onIsClipServerRunning(() => clipServer!.isEnabled());
MainMessenger.onIsRunningInBackground(() => clipServer!.isRunInBackgroundEnabled());

MainMessenger.onSetClipServerEnabled(({ isClipServerRunning }) =>
  clipServer?.setEnabled(isClipServerRunning),
);
MainMessenger.onSetClipServerImportLocation((dir) => clipServer?.setImportLocation(dir));
MainMessenger.onSetRunningInBackground(({ isRunInBackground }) => {
  if (clipServer === null) {
    return;
  }
  clipServer.setRunInBackground(isRunInBackground);
  if (isRunInBackground) {
    createTrayMenu();
  } else if (tray) {
    tray.destroy();
    tray = null;
  }
});

MainMessenger.onStoreFile(({ directory, filenameWithExt, imgBase64 }) =>
  clipServer!.storeImageWithoutImport(directory, filenameWithExt, imgBase64),
);

// Forward files from the main window to the preview window
MainMessenger.onSendPreviewFiles((msg) => {
  // Create preview window if needed, and send the files selected in the primary window
  if (!previewWindow || previewWindow.isDestroyed()) {
    // The Window object might've been destroyed if it was hidden for too long -> Recreate it
    if (previewWindow?.isDestroyed()) {
      console.warn('Preview window was destroyed! Attemping to recreate...');
    }

    previewWindow = createPreviewWindow();
    MainMessenger.onceInitialized().then(() => {
      if (previewWindow) {
        MainMessenger.sendPreviewFiles(previewWindow.webContents, msg);
      }
    });
  } else {
    MainMessenger.sendPreviewFiles(previewWindow.webContents, msg);
    if (!previewWindow.isVisible()) {
      previewWindow.show();
    }
    previewWindow.focus();
  }
});

// Set native window theme (frame, menu bar)
MainMessenger.onSetTheme((msg) => (nativeTheme.themeSource = msg.theme));

MainMessenger.onDragExport((absolutePaths) => {
  if (mainWindow === null || absolutePaths.length === 0) {
    return;
  }

  let previewIcon = nativeImage.createFromPath(absolutePaths[0]);
  if (previewIcon) {
    // Resize preview to something resonable: taking into account aspect ratio
    const ratio = previewIcon.getAspectRatio();
    previewIcon =
      ratio > 1 ? previewIcon.resize({ width: 200 }) : previewIcon.resize({ height: 200 });
  }

  // Need to cast item as `any` since the types are not correct. The `files` field is allowed but
  // not according to the electron documentation where it is `file`.
  mainWindow.webContents.startDrag({
    files: absolutePaths,
    // Just show the first image as a thumbnail for now
    // TODO: Show some indication that multiple images are dragged, would be cool to show a stack of the first few of them
    icon: previewIcon.isEmpty() ? AppIcon : previewIcon,
  } as any);
});

MainMessenger.onClearDatabase(() => {
  mainWindow?.webContents.reload();
  previewWindow?.hide();
});

MainMessenger.onToggleDevTools(() => mainWindow?.webContents.toggleDevTools());

MainMessenger.onReload(() => mainWindow?.webContents.reload());

MainMessenger.onOpenDialog(dialog);

MainMessenger.onGetPath(app);

MainMessenger.onIsFullScreen(() => mainWindow?.isFullScreen() ?? false);

MainMessenger.onSetFullScreen((isFullScreen) => mainWindow?.setFullScreen(isFullScreen));

MainMessenger.onGetZoomFactor(() => mainWindow?.webContents.zoomFactor ?? 1);

MainMessenger.onSetZoomFactor((level: number) => mainWindow?.webContents.setZoomFactor(level));

MainMessenger.onWindowSystemButtonPressed((button: WindowSystemButtonPress) => {
  if (mainWindow !== null) {
    switch (button) {
      case WindowSystemButtonPress.Close:
        mainWindow.close();
        break;

      case WindowSystemButtonPress.Maximize:
        mainWindow.maximize();
        break;

      case WindowSystemButtonPress.Minimize:
        mainWindow.minimize();
        break;

      case WindowSystemButtonPress.Restore:
        mainWindow.restore();
        break;

      default:
        break;
    }
  }
});

MainMessenger.onIsMaximized(() => mainWindow?.isMaximized() ?? false);

function getVersion() {
  if (isDev()) {
    // Weird quirk: it returns the Electron version in dev mode
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../package.json').version;
  } else {
    return app.getVersion();
  }
}
MainMessenger.onGetVersion(() => getVersion());

MainMessenger.onCheckForUpdates(() => {
  autoUpdater.checkForUpdates();
});
