import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {version} from './package.json';
import {runNotes} from './src/app/notes';
import {outboxSize} from './src/app/outbox';
import {runSelfTest} from './src/app/selftest';
import {loadFilters, saveFilters, type Filters} from './src/app/store';
import {applyPlan, runSync, type SyncPlan} from './src/app/sync';
import {runTasks} from './src/app/tasks';
import {getUi, onUi, setUi, type UiState} from './src/app/ui';
import {loadConfig, saveConfig} from './src/config';
import {currentScreen, onScreen, show, type Screen} from './src/nav';
import {allFindings, describeError, eventLog, onChange} from './src/spike/report';
import {sendReport} from './src/worker';

/**
 * The plugin panel: Tasks, Notes, Sync and the settings. E-ink rules: black
 * on white, no animation, no press feedback. Buttons are about as big as the
 * boxes on the page.
 */
function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>(currentScreen());
  useEffect(() => onScreen(setScreen), []);
  return <View style={styles.root}>{screen === 'config' ? <ConfigScreen /> : <MainScreen />}</View>;
}

function Button({
  label,
  onPress,
  disabled,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.button, selected && styles.buttonOn, disabled && styles.buttonOff]}
      android_disableSound>
      <Text style={[styles.buttonText, selected && styles.buttonTextOn, disabled && styles.buttonTextOff]}>
        {label}
      </Text>
    </Pressable>
  );
}

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const DOMAINS = ['Home', 'Work'];

function MainScreen() {
  const [ui, setLocal] = useState<UiState>(getUi());
  const [log, setLog] = useState(eventLog());
  const [queued, setQueued] = useState(0);
  const [filters, setFilters] = useState<Filters>({priorities: [], domains: []});
  useEffect(() => onUi(setLocal), []);
  useEffect(() => onChange(() => setLog(eventLog())), []);
  useEffect(() => {
    outboxSize().then(setQueued).catch(() => undefined);
  }, [ui.busy]);
  useEffect(() => {
    loadFilters().then(setFilters).catch(() => undefined);
  }, []);

  const toggle = (kind: keyof Filters, value: string) => {
    const has = filters[kind].includes(value);
    const next = {...filters, [kind]: has ? filters[kind].filter(v => v !== value) : [...filters[kind], value]};
    setFilters(next);
    saveFilters(next).catch(() => undefined);
  };

  return (
    <>
      <Text style={styles.title}>{ui.title}</Text>
      <View style={styles.row}>
        <Button label="Tasks" onPress={() => runTasks()} disabled={ui.busy} />
        <Button label="Notes" onPress={() => runNotes()} disabled={ui.busy} />
        <Button label="Sync" onPress={() => runSync()} disabled={ui.busy} />
        <Button label="Config" onPress={() => show('config')} disabled={ui.busy} />
        <Button label="Close" onPress={() => PluginManager.closePluginView()} />
      </View>
      <View style={styles.row}>
        <Text style={styles.filterLabel}>Show</Text>
        {PRIORITIES.map(p => (
          <Button key={p} label={p} selected={filters.priorities.includes(p)} onPress={() => toggle('priorities', p)} />
        ))}
        {DOMAINS.map(d => (
          <Button key={d} label={d} selected={filters.domains.includes(d)} onPress={() => toggle('domains', d)} />
        ))}
        <Text style={styles.filterHint}>(none selected = all)</Text>
      </View>

      {ui.plan ? <PlanView plan={ui.plan} busy={ui.busy} /> : null}

      <ScrollView style={styles.lines}>
        {ui.lines.length === 0 ? (
          <Text style={styles.hint}>
            Tasks makes a notebook with all your open tasks, one page for every 14. Tick a box for done,
            mark the arrow box for not today. Notes is today's page for writing. Tap the SYNC box on a
            page (or Sync here) to send it to Tana.
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
        {log.slice(-2).map(entry => (
          <Text key={entry.at + entry.msg} style={styles.logLine} numberOfLines={1}>
            {entry.at.slice(11, 19)} {entry.msg}
          </Text>
        ))}
        <View style={styles.footerRow}>
          <Text style={styles.logLine}>
            v{version}
            {queued ? `  ·  ${queued} change${queued === 1 ? '' : 's'} waiting to send` : ''}
          </Text>
          <View style={styles.footerLinks}>
            <Pressable onPress={() => runSelfTest()} disabled={ui.busy} android_disableSound>
              <Text style={styles.link}>Self-test</Text>
            </Pressable>
            <SendReport />
          </View>
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
      <Text style={[styles.link, styles.linkGap]}>{message || 'Send report'}</Text>
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
          {n.isTask ? '[ ] ' : '- '}
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
        <Button label="Save" onPress={() => saveConfig({workerUrl, passphrase}).then(() => setMessage('Saved'))} />
        <Button label="Back" onPress={() => show('report')} />
      </View>
      {message ? <Text style={styles.line}>{message}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#ffffff', padding: 24},
  title: {fontSize: 30, fontWeight: 'bold', color: '#000000', marginBottom: 10},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 6},
  button: {
    borderWidth: 2,
    borderColor: '#000000',
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 10,
    marginBottom: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  buttonOn: {backgroundColor: '#000000'},
  buttonOff: {borderColor: '#999999'},
  buttonText: {fontSize: 22, color: '#000000', fontWeight: 'bold'},
  buttonTextOn: {color: '#ffffff'},
  buttonTextOff: {color: '#999999'},
  filterLabel: {fontSize: 22, color: '#000000', marginRight: 10, marginBottom: 8},
  filterHint: {fontSize: 18, color: '#555555', marginBottom: 8},
  lines: {flex: 1, marginTop: 4},
  line: {fontSize: 22, color: '#000000', marginBottom: 4},
  hint: {fontSize: 22, color: '#444444', lineHeight: 30},
  plan: {borderWidth: 2, borderColor: '#000000', padding: 12, marginBottom: 10},
  planTitle: {fontSize: 24, fontWeight: 'bold', color: '#000000', marginBottom: 6},
  planLine: {fontSize: 22, color: '#000000', marginBottom: 4},
  footer: {borderTopWidth: 2, borderColor: '#000000', paddingTop: 6},
  footerRow: {flexDirection: 'row', justifyContent: 'space-between'},
  footerLinks: {flexDirection: 'row'},
  logLine: {fontSize: 18, color: '#333333'},
  link: {fontSize: 20, color: '#000000', textDecorationLine: 'underline'},
  linkGap: {marginLeft: 20},
  label: {fontSize: 22, color: '#000000', marginTop: 8},
  input: {
    borderWidth: 2,
    borderColor: '#000000',
    fontSize: 22,
    color: '#000000',
    padding: 8,
    marginTop: 6,
    marginBottom: 6,
  },
});

export default App;
