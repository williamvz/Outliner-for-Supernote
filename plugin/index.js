/**
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import App from './App';
import {name as appName} from './app.json';
import {version} from './package.json';
import {show} from './src/nav';
import {logEvent, loadSaved} from './src/spike/report';
import {runNotes} from './src/app/notes';
import {runSync} from './src/app/sync';
import {registerSyncTap} from './src/app/syncTap';
import {runTasks} from './src/app/tasks';

const BUTTON_TASKS = 100;
const BUTTON_SYNC = 101;
const BUTTON_PANEL = 102;
const BUTTON_NOTES = 103;

const TOOLBAR = 1;
const WITH_UI = 1;

const icon = asset => Image.resolveAssetSource(asset).uri;

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();
loadSaved();
logEvent(`plugin loaded, v${version}`);

// Today and Sync open the plugin view so progress and errors are visible.
PluginManager.registerButton(TOOLBAR, ['NOTE'], {
  id: BUTTON_TASKS,
  name: 'Tasks',
  icon: icon(require('./assets/icons/today.png')),
  showType: WITH_UI,
});

PluginManager.registerButton(TOOLBAR, ['NOTE'], {
  id: BUTTON_NOTES,
  name: 'Notes',
  icon: icon(require('./assets/icons/notes.png')),
  showType: WITH_UI,
});

PluginManager.registerButton(TOOLBAR, ['NOTE'], {
  id: BUTTON_SYNC,
  name: 'Sync',
  icon: icon(require('./assets/icons/sync.png')),
  showType: WITH_UI,
});

PluginManager.registerButton(TOOLBAR, ['NOTE', 'DOC'], {
  id: BUTTON_PANEL,
  name: 'Tana',
  icon: icon(require('./assets/icons/tana.png')),
  showType: WITH_UI,
});

PluginManager.registerButtonListener({
  onButtonPress(event) {
    logEvent(`button ${JSON.stringify(event)} (id is ${typeof event?.id})`);
    switch (Number(event?.id)) {
      case BUTTON_TASKS:
        show('report');
        runTasks();
        break;
      case BUTTON_NOTES:
        show('report');
        runNotes();
        break;
      case BUTTON_SYNC:
        show('report');
        runSync();
        break;
      case BUTTON_PANEL:
        show('report');
        break;
    }
  },
});

PluginManager.registerConfigButton();
PluginManager.registerConfigButtonListener({
  onClick() {
    logEvent('config button');
    show('config');
    PluginManager.showPluginView();
  },
});

registerSyncTap();
