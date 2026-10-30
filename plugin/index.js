/**
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import App from './App';
import {name as appName} from './app.json';
import {version} from './package.json';
import {show} from './src/nav';
import {logEvent, record, loadSaved} from './src/spike/report';
import {runSync} from './src/spike/sync';
import {runToday} from './src/spike/today';
import {registerSpikeListeners} from './src/spike/listeners';

const BUTTON_TODAY = 100;
const BUTTON_SYNC = 101;
const BUTTON_PANEL = 102;
const BUTTON_PING = 103;

const TOOLBAR = 1;
const NO_UI = 0;
const WITH_UI = 1;

const icon = asset => Image.resolveAssetSource(asset).uri;

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();
loadSaved();
logEvent(`plugin loaded, v${version}`);

// Today and Sync open the plugin view so progress and errors are visible.
// Ping keeps showType 0: v0.1's Today and Sync ran without a view, and Ping
// confirms that with nothing else involved.
PluginManager.registerButton(TOOLBAR, ['NOTE'], {
  id: BUTTON_TODAY,
  name: 'Today',
  icon: icon(require('./assets/icons/today.png')),
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

PluginManager.registerButton(TOOLBAR, ['NOTE'], {
  id: BUTTON_PING,
  name: 'Ping',
  icon: icon(require('./assets/icons/ping.png')),
  showType: NO_UI,
});

PluginManager.registerButtonListener({
  onButtonPress(event) {
    logEvent(`button ${JSON.stringify(event)} (id is ${typeof event?.id})`);
    switch (Number(event?.id)) {
      case BUTTON_TODAY:
        show('report');
        runToday();
        break;
      case BUTTON_SYNC:
        show('report');
        runSync();
        break;
      case BUTTON_PANEL:
        show('report');
        break;
      case BUTTON_PING:
        record('q5-background', 'pass', 'Ping (showType 0) reached the plugin');
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

registerSpikeListeners();
