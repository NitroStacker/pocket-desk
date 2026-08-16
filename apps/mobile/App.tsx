import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConnectionScreen } from './src/components/ConnectionScreen';
import { RemoteScreen } from './src/components/RemoteScreen';
import { useRemoteSession } from './src/hooks/useRemoteSession';

export default function App() {
  const session = useRemoteSession();

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {session.hasSession ? (
        <RemoteScreen session={session} />
      ) : (
        <ConnectionScreen
          error={session.error}
          status={session.status}
          onConnect={session.connect}
        />
      )}
    </SafeAreaProvider>
  );
}
