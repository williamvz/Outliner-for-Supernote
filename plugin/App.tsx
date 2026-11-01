import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {version} from './package.json';
import {applyPlan, runSync, type SyncPlan} from './src/app/sync';
import {runSelfTest} from './src/app/selftest';
import {outboxSize} from './src/app/outbox';
import {runToday} from './src/app/today';
import {getUi, onUi, setUi, type UiState} from './src/app/ui';
import {loadConfig, saveConfig} from './src/config';
import {currentScreen, onScreen, show, type Screen} from './src/nav';
import {allFindings, describeError, eventLog, onChange} from './src/spike/report';
import {sendReport} from './src/worker';

/**
 * The plugin panel: Today, Sync, Self-test and Config. E-ink rules: black on
 * white, big targets, no animation, no press feedback.
 */
function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>(currentScreen());
  useEffect(() => onScreen(setScreen), []);
  return <View style={styles.root}>{screen === 'config' ? <ConfigScreen /> : <MainScreen />}</View>;
}

function Button({label, onPress, disabled}: {label: string; onPress: () => void; disabled?: boolean}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.button, disabled && styles.buttonOff]}
      android_disableSound>
      <Text style={[styles.buttonText, disabled && styles.buttonTextOff]}>{label}</Text>
    </Pressable>
  );
}

function MainScreen() {
  const [ui, setLocal] = useState<UiState>(getUi());
  const [log, setLog] = useState(eventLog());
  const [queued, setQueued] = useState(0);
  useEffect(() => onUi(setLocal), []);
  useEffect(() => onChange(() => setLog(eventLog())), []);
  useEffect(() => {
    outboxSize().then(setQueued).catch(() => undefined);
  }, [ui.busy]);

  return (
    <>
      <Text style={styles.title}>{ui.title}</Text>
      <View style={styles.row}>
        <Button label="Today" onPress={() => runToday()} disabled={ui.busy} />
        <Button label="Sync" onPress={() => runSync()} disabled={ui.busy} />
        <Button label="Self-test" onPress={() => runSelfTest()} disabled={ui.busy} />
        <Button label="Config" onPress={() => show('config')} disabled={ui.busy} />
        <Button label="Close" onPress={() => PluginManager.closePluginView()} />
      </View>

      {ui.plan ? <PlanView plan={ui.plan} busy={ui.busy} /> : null}

      <ScrollView style={styles.lines}>
        {ui.lines.length === 0 ? (
          <Text style={styles.hint}>
            Today makes a page with your most urgent tasks. Tick a box, or mark NOT TODAY, and write notes
            below the line. Then tap Sync.
          </Text>
        ) : (
          ui.lines.map((line, i) => (
            <Text key={`${i}-${line}`} style={styles.line}>
              {line}
            </Text>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        {log.slice(-3).map(entry => (
          <Text key={entry.at + entry.msg} style={styles.logLine} numberOfLines={1}>
            {entry.at.slice(11, 19)} {entry.msg}
          </Text>
        ))}
        <View style={styles.footerRow}>
          <Text style={styles.logLine}>
            v{version}
            {queued ? `  ·  ${queued} change${queued === 1 ? '' : 's'} waiting to send` : ''}
          </Text>
          <SendReport />
        </View>
      </View>
    </>
  );
}

function SendReport() {
  const [message, setMessage] = useState('');
  return (
    <Pressable
      onPress={() => {
        setMessage('sending…');
        sendReport({findings: allFindings(), log: eventLog(), sentAt: new Date().toISOString()})
          .then(() => setMessage('report sent'))
          .catch(e => setMessage(describeError(e)));
      }}
      android_disableSound>
      <Text style={styles.link}>{message || 'Send report'}</Text>
    </Pressable>
  );
}

function PlanView({plan, busy}: {plan: SyncPlan; busy: boolean}) {
  const nothing = !plan.done.length && !plan.skip.length && !plan.notes.length;
  return (
    <View style={styles.plan}>
      <Text style={styles.planTitle}>{nothing ? 'Nothing new to send' : 'Ready to send to Tana'}</Text>
      {plan.done.map(r => (
        <Text key={`d${r.id}`} style={styles.planLine}>
          ✓ done: {r.name}
        </Text>
      ))}
      {plan.skip.map(r => (
        <Text key={`s${r.id}`} style={styles.planLine}>
          → tomorrow: {r.name}
        </Text>
      ))}
      {plan.notes.map(n => (
        <Text key={n.key} style={styles.planLine}>
          {'    '.repeat(n.level)}
          {n.isTask ? '☐ ' : '- '}
          {n.text}
        </Text>
      ))}
      <View style={styles.row}>
        {nothing ? null : <Button label="Send to Tana" onPress={() => applyPlan(plan)} disabled={busy} />}
        <Button label={nothing ? 'OK' : 'Cancel'} onPress={() => setUi({plan: null})} disabled={busy} />
      </View>
    </View>
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
      <Text style={styles.title}>Config</Text>
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
          onPress={() => saveConfig({workerUrl, passphrase}).then(() => setMessage('Saved'))}
        />
        <Button label="Back" onPress={() => show('report')} />
      </View>
      {message ? <Text style={styles.line}>{message}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#ffffff', padding: 32},
  title: {fontSize: 38, fontWeight: 'bold', color: '#000000', marginBottom: 20},
  row: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12},
  button: {
    borderWidth: 3,
    borderColor: '#000000',
    paddingVertical: 20,
    paddingHorizontal: 30,
    marginRight: 16,
    marginBottom: 12,
  },
  buttonOff: {borderColor: '#999999'},
  buttonText: {fontSize: 30, color: '#000000', fontWeight: 'bold'},
  buttonTextOff: {color: '#999999'},
  lines: {flex: 1, marginTop: 8},
  line: {fontSize: 26, color: '#000000', marginBottom: 6},
  hint: {fontSize: 26, color: '#444444', lineHeight: 36},
  plan: {borderWidth: 3, borderColor: '#000000', padding: 18, marginBottom: 14},
  planTitle: {fontSize: 30, fontWeight: 'bold', color: '#000000', marginBottom: 10},
  planLine: {fontSize: 26, color: '#000000', marginBottom: 6},
  footer: {borderTopWidth: 2, borderColor: '#000000', paddingTop: 8},
  footerRow: {flexDirection: 'row', justifyContent: 'space-between'},
  logLine: {fontSize: 20, color: '#333333'},
  link: {fontSize: 22, color: '#000000', textDecorationLine: 'underline'},
  label: {fontSize: 28, color: '#000000', marginTop: 12},
  input: {
    borderWidth: 2,
    borderColor: '#000000',
    fontSize: 28,
    color: '#000000',
    padding: 14,
    marginTop: 8,
    marginBottom: 8,
  },
});

export default App;
