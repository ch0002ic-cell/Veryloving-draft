import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Header } from '../components/Header';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { colors, fonts, spacing } from '../constants/theme';
import { roboticsMockDriver } from '../services/robotics-mock-driver';
import { base64ToBytes, utf8BytesToString } from '../utils/base64';
import { useAppState } from '../context/AppContext';
import { config } from '../utils/config';
import {
  DEFAULT_ROBOTICS_SIMULATOR_URL,
  loadRoboticsSimulatorURL
} from '../services/robotics-simulator-config';

const TELEMETRY_UUID = process.env.EXPO_PUBLIC_ROBOTICS_TELEMETRY_CHARACTERISTIC_UUID || 'f000aa01-0451-4000-b000-000000000000';
const ROBOTICS_SERVICE_UUID = process.env.EXPO_PUBLIC_ROBOTICS_SERVICE_UUID || 'f000aa00-0451-4000-b000-000000000000';

export function RoboticsSimulatorScreen() {
  const [robots, setRobots] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [obstacle, setObstacle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [simulatorURL, setSimulatorURL] = useState(config.roboticsSimulatorURL || DEFAULT_ROBOTICS_SIMULATOR_URL);
  const [savedSimulatorURL, setSavedSimulatorURL] = useState(null);
  const { setDevice } = useAppState();

  const refresh = useCallback(async () => {
    const devices = await roboticsMockDriver.scan();
    setRobots(devices);
    setSelectedId((current) => devices.some((robot) => robot.id === current) ? current : devices[0]?.id || null);
    return devices;
  }, []);

  useEffect(() => {
    loadRoboticsSimulatorURL().then((saved) => {
      if (saved) {
        setSimulatorURL(saved);
        setSavedSimulatorURL(saved);
      }
    }).catch(() => {});
    refresh().catch((nextError) => setError(nextError.message));
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cleanup;
    let cancelled = false;
    roboticsMockDriver.connect({ id: selectedId }).then(async (connected) => {
      await setDevice(connected);
      return roboticsMockDriver.subscribeToNotifications(
      selectedId,
      ROBOTICS_SERVICE_UUID,
      TELEMETRY_UUID,
      (value) => {
        try { setTelemetry(JSON.parse(utf8BytesToString(base64ToBytes(value)))); } catch {}
      });
    }).then((unsubscribe) => {
      if (cancelled) unsubscribe();
      else cleanup = unsubscribe;
    }).catch((nextError) => { if (!cancelled) setError(nextError.message); });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [selectedId, setDevice]);

  const run = async (operation) => {
    setBusy(true);
    setError(null);
    try { await operation(); } catch (nextError) { setError(nextError.message); } finally { setBusy(false); }
  };

  const setCount = (count) => run(async () => {
    await roboticsMockDriver.setRobotCount(count);
    await refresh();
  });
  const toggleObstacle = () => run(async () => {
    const next = !obstacle;
    await roboticsMockDriver.controlRobot(selectedId, { obstacle: next });
    setObstacle(next);
  });
  const loseConnection = () => run(async () => {
    await roboticsMockDriver.controlRobot(selectedId, { disconnect: true });
    await refresh();
  });
  const saveSimulatorURL = () => run(async () => {
    const saved = await roboticsMockDriver.setSimulatorURL(simulatorURL);
    setSavedSimulatorURL(saved);
    setRobots([]);
    setSelectedId(null);
    await refresh();
  });
  const resetSimulatorURL = () => run(async () => {
    await roboticsMockDriver.setSimulatorURL('');
    setSimulatorURL(config.roboticsSimulatorURL || DEFAULT_ROBOTICS_SIMULATOR_URL);
    setSavedSimulatorURL(null);
    setRobots([]);
    setSelectedId(null);
    await refresh();
  });

  return (
    <Screen>
      <Header title="Robotics Simulator Dashboard" subtitle="Local virtual robot farm" showBack backLabel="Back" />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Card style={styles.card}>
        <Text style={styles.title}>Simulator connection</Text>
        <Text style={styles.muted}>Use a LAN ws:// address or a secure wss:// tunnel. This override applies immediately and survives relaunches.</Text>
        <TextInput
          accessibilityLabel="Robotics simulator WebSocket URL"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setSimulatorURL}
          placeholder="wss://simulator.example.test"
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
          value={simulatorURL}
        />
        <Button title="Save and reconnect" disabled={busy} onPress={saveSimulatorURL} />
        {savedSimulatorURL ? <Button title="Use build default" variant="ghost" disabled={busy} onPress={resetSimulatorURL} /> : null}
      </Card>
      <Card style={styles.card}>
        <Text style={styles.title}>Robot farm</Text>
        <View style={styles.row}>
          {[1, 2, 3].map((count) => <Button key={count} compact title={`${count} robot${count > 1 ? 's' : ''}`} disabled={busy} onPress={() => setCount(count)} style={styles.flex} />)}
        </View>
        <Text style={styles.muted}>{robots.length} online</Text>
        <View style={styles.row}>
          {robots.map((robot) => <Button key={robot.id} compact title={robot.id} variant={robot.id === selectedId ? 'orange' : 'ghost'} onPress={() => setSelectedId(robot.id)} style={styles.flex} />)}
        </View>
      </Card>
      <Card style={styles.card}>
        <Text style={styles.title}>Safety edge cases</Text>
        <Button title={obstacle ? 'Clear obstacle' : 'Set obstacle (STOP)'} disabled={!selectedId || busy} onPress={toggleObstacle} />
        <Button title="Simulate lost connection" variant="danger" disabled={!selectedId || busy} onPress={loseConnection} />
      </Card>
      <Card style={styles.card}>
        <Text style={styles.title}>Live telemetry (100 ms)</Text>
        <Telemetry label="Latitude" value={telemetry?.latitude?.toFixed?.(6)} />
        <Telemetry label="Longitude" value={telemetry?.longitude?.toFixed?.(6)} />
        <Telemetry label="Battery" value={Number.isFinite(telemetry?.battery) ? `${Math.round(telemetry.battery)}%` : null} />
        <Telemetry label="Heading" value={Number.isFinite(telemetry?.heading) ? `${Math.round(telemetry.heading)}°` : null} />
      </Card>
    </Screen>
  );
}

function Telemetry({ label, value }) {
  return <View style={styles.telemetry}><Text style={styles.muted}>{label}</Text><Text style={styles.value}>{value || '—'}</Text></View>;
}

const styles = StyleSheet.create({
  card: { gap: spacing.mdSm },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flexGrow: 1 },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft },
  value: { fontFamily: fonts.semibold, color: colors.ink },
  telemetry: { flexDirection: 'row', justifyContent: 'space-between' },
  error: { color: colors.redAccessible, fontFamily: fonts.semibold },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 8, paddingHorizontal: 12, color: colors.ink, fontFamily: fonts.regular, backgroundColor: colors.paper }
});
