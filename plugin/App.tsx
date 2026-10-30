import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {loadConfig, saveConfig} from './src/config';
import {currentScreen, onScreen, show, type Screen} from './src/nav';
import {runQuickChecks} from './src/spike/checks';
import {runSync} from './src/spike/sync';
import {runToday} from './src/spike/today';
import {
  allFindings,
  describeError,
  eventLog,
  onChange,
  record,
  type Finding,
} from './src/spike/report';
import {sendReport} from './src/worker';

/**
 * Plugin panel for the M0 spike: the findings report and the config form.
 * Today and Sync are here as well as on the toolbar, so a lost button event
 * doesn't block a test. E-ink rules: black on white, no animations, no press
 * feedback.
 */
function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>(currentScreen());
  useEffect(() => onScreen(setScreen), []);
  return (
    <View style={styles.root}>
      {screen === 'config' ? <ConfigScreen /> : <ReportScreen />}
    </View>
  );
}

function Button({label, onPress}: {label: string; onPress: () => void}) {
  return (
    <Pressable onPress={onPress} style={styles.button} android_disableSound>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const MARK: Record<Finding['status'], string> = {
  pass: 'PASS',
  fail: 'FAIL',
  info: 'INFO',
  pending: '—',
};

function ReportScreen() {
  const [findings, setFindings] = useState(allFindings());
  const [log, setLog] = useState(eventLog());
  const [busy, setBusy] = useState('');
  useEffect(
    () =>
      onChange(() => {
        setFindings(allFindings());
        setLog(eventLog());
      }),
    [],
  );

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(`${label}…`);
    try {
      await fn();
      setBusy(`${label}: done`);
    } catch (e) {
      setBusy(`${label}: ${describeError(e)}`);
    }
  };

  return (
    <>
      <Text style={styles.title}>Tana Sync · spike report</Text>
      <View style={styles.row}>
        <Button label="Today page" onPress={() => run('Today', runToday)} />
        <Button label="Sync page" onPress={() => run('Sync', runSync)} />
        <Button label="Run checks" onPress={() => run('Checks', runQuickChecks)} />
        <Button
          label="Send report"
          onPress={() =>
            run('Send', () =>
              sendReport({
                findings: allFindings(),
                log: eventLog(),
                sentAt: new Date().toISOString(),
              }).then(() =>
                record('net', 'pass', 'report uploaded'),
              ),
            )
          }
        />
        <Button label="Config" onPress={() => show('config')} />
        <Button label="Close" onPress={() => PluginManager.closePluginView()} />
      </View>
      {busy ? <Text style={styles.busy}>{busy}</Text> : null}
      <View style={styles.activity}>
        {log.slice(-6).map(entry => (
          <Text key={entry.at + entry.msg} style={styles.logLine} numberOfLines={1}>
            {entry.at.slice(11, 19)}  {entry.msg}
          </Text>
        ))}
      </View>
      <ScrollView style={styles.list}>
        {findings.map(f => (
          <View key={f.id} style={styles.finding}>
            <Text style={styles.findingTitle}>
              {MARK[f.status]}  {f.title}
              {f.ms !== undefined ? `  (${f.ms} ms)` : ''}
            </Text>
            {f.detail ? <Text style={styles.detail}>{f.detail}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

function ConfigScreen() {
  const [workerUrl, setWorkerUrl] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    loadConfig().then(c => {
      setWorkerUrl(c.workerUrl);
      setPassphrase(c.passphrase);
    });
  }, []);

  return (
    <>
      <Text style={styles.title}>Tana Sync · config</Text>
      <Text style={styles.label}>Worker URL</Text>
      <TextInput
        style={styles.input}
        value={workerUrl}
        onChangeText={setWorkerUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://tana-sync.example.workers.dev"
      />
      <Text style={styles.label}>Device passphrase</Text>
      <TextInput
        style={styles.input}
        value={passphrase}
        onChangeText={setPassphrase}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="four words with spaces"
      />
      <View style={styles.row}>
        <Button
          label="Save"
          onPress={() =>
            saveConfig({workerUrl, passphrase}).then(() => setMessage('Saved'))
          }
        />
        <Button label="Back" onPress={() => show('report')} />
      </View>
      {message ? <Text style={styles.busy}>{message}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#ffffff', padding: 32},
  title: {fontSize: 34, fontWeight: 'bold', color: '#000000', marginBottom: 20},
  row: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16},
  button: {
    borderWidth: 3,
    borderColor: '#000000',
    paddingVertical: 18,
    paddingHorizontal: 26,
    marginRight: 16,
    marginBottom: 12,
  },
  buttonText: {fontSize: 26, color: '#000000'},
  busy: {fontSize: 24, color: '#000000', marginBottom: 12},
  activity: {borderWidth: 2, borderColor: '#000000', padding: 10, marginBottom: 12},
  logLine: {fontSize: 20, color: '#000000'},
  list: {flex: 1},
  finding: {borderTopWidth: 1, borderColor: '#000000', paddingVertical: 12},
  findingTitle: {fontSize: 26, fontWeight: 'bold', color: '#000000'},
  detail: {fontSize: 22, color: '#000000', marginTop: 6},
  label: {fontSize: 26, color: '#000000', marginTop: 12},
  input: {
    borderWidth: 2,
    borderColor: '#000000',
    fontSize: 26,
    color: '#000000',
    padding: 14,
    marginTop: 8,
    marginBottom: 8,
  },
});

export default App;
