import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';

import { ThemeProvider, radius, useTheme, withAlpha } from '@/theme/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog';
import { formatBytes } from '@/ui/format';
import { ProgressBar } from '@/ui/progress';
import { Text, green500 } from '@/ui/text';

import { useConnectionActions } from './connections-sync';
import { useDemoStore, type Connection } from './demo-store';
import { personName, type FileMeta } from './sample-data';

/** One connected device. Themed with the remote user's colour, like the web app. */
export function ConnectionCard({ connection }: { connection: Connection }) {
  return (
    <ThemeProvider name={connection.person.colorId}>
      <Card connection={connection} />
    </ThemeProvider>
  );
}

const isDone = (file: FileMeta, transferred: number) => transferred >= file.size;

function Card({ connection }: { connection: Connection }) {
  const t = useTheme();
  const { sendFiles } = useDemoStore();
  const { remove } = useConnectionActions();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { person, status, transfer } = connection;

  const transferDone = !!transfer && transfer.files.every((f, i) => isDone(f, transfer.transferred[i]));
  const canSend = status === 'idle' || transferDone;
  const name = personName(person);

  return (
    <View
      style={{
        gap: 12,
        padding: 16,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: withAlpha(t.primary, 0.5),
        backgroundColor: t.card,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar emoji={person.emoji} label={name} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="700" size={16}>
            {name}
          </Text>
          {status === 'sending-request' ? <Pulse>Sending request...</Pulse> : null}
          {status === 'connecting' ? <Pulse>Connecting...</Pulse> : null}
          {status === 'connected' && !transferDone ? (
            <Text style={{ color: green500(0.5) }}>Connected</Text>
          ) : null}
        </View>
      </View>

      {transfer ? <FilesList connection={connection} done={transferDone} /> : null}

      <View style={{ flexDirection: 'row-reverse', gap: 12 }}>
        <Button
          variant="destructive"
          size="icon"
          icon="trash-2"
          accessibilityLabel="Delete connection"
          onPress={() => setConfirmingDelete(true)}
        />
        {canSend ? (
          <Button variant="ghost" icon="send" onPress={() => sendFiles(connection.id)}>
            Send Files
          </Button>
        ) : null}
      </View>

      <Dialog visible={confirmingDelete} onRequestClose={() => setConfirmingDelete(false)}>
        <DialogTitle>Are you sure?</DialogTitle>
        <DialogDescription>
          This will delete the connection. To communicate with this device again, you will need to
          create a new connection.
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onPress={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onPress={() => {
              setConfirmingDelete(false);
              remove(connection.id);
            }}>
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </View>
  );
}

function FilesList({ connection, done }: { connection: Connection; done: boolean }) {
  const t = useTheme();
  const { clearTransfer } = useDemoStore();
  const transfer = connection.transfer!;
  // Only the file currently moving shows a progress bar.
  const activeIndex = transfer.files.findIndex((f, i) => !isDone(f, transfer.transferred[i]));

  return (
    <View
      style={{ gap: 8, padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: t.border }}>
      {transfer.files.map((file, i) => (
        <FileRow
          key={file.name}
          file={file}
          transferred={transfer.transferred[i]}
          active={connection.status === 'connected' && i === activeIndex}
        />
      ))}
      {done ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Button variant="link" icon="trash-2" onPress={() => clearTransfer(connection.id)}>
            Clear
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function FileRow({
  file,
  transferred,
  active,
}: {
  file: FileMeta;
  transferred: number;
  active: boolean;
}) {
  const t = useTheme();
  const done = isDone(file, transferred);

  return (
    <View style={{ gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: t.border }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          paddingHorizontal: 12,
        }}>
        <Feather
          name={done ? 'check-circle' : 'file'}
          size={20}
          color={done ? green500(0.5) : t.foreground}
        />
        <Text numberOfLines={1} style={{ flex: 1 }}>
          {file.name}
        </Text>
      </View>

      {active && !done ? (
        <View style={{ gap: 4, paddingHorizontal: 12, paddingBottom: 8 }}>
          <ProgressBar fraction={transferred / file.size} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text size={12}>{formatBytes(transferred)}</Text>
            <Text size={12}>{formatBytes(file.size)}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Muted text that fades in and out (web: animate-pulse). */
function Pulse({ children }: { children: string }) {
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ opacity }}>
      <Text tone="muted">{children}</Text>
    </Animated.View>
  );
}
