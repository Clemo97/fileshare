import { useState } from 'react';

import { describeError } from '@/lib/supabase';
import { Button } from '@/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog';
import { RED_500, Text } from '@/ui/text';

import { personName } from './sample-data';
import { useSession } from './session';

/**
 * "Delete my account", in two steps. There is no sign-up in this app: the account is created
 * for the user on first launch, but Apple still requires a way to delete it inside the app.
 */
export function AccountDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const session = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.status !== 'ready') return null;

  const close = () => {
    setConfirming(false);
    setError(null);
    onClose();
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await session.deleteAccount();
      close();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog visible={visible} onRequestClose={busy ? () => {} : close}>
      {confirming ? (
        <>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This can’t be undone. Your connections are removed on both devices, anything waiting to
            be sent is cancelled, and you will have to pair your devices again. Files you already
            saved are not affected.
          </DialogDescription>
          {error ? (
            <Text size={13} style={{ color: RED_500, textAlign: 'center' }}>
              {error}
            </Text>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onPress={close}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onPress={remove}>
              {busy ? 'Deleting…' : 'Delete account'}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <DialogTitle>Your account</DialogTitle>
          <DialogDescription>
            {`You are ${personName(session.me)}. This app has no sign-up: it created this account for you the first time you opened it. Deleting it removes your connections and everything linked to them, and this device gets a new name.`}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onPress={close}>
              Close
            </Button>
            <Button variant="destructive" onPress={() => setConfirming(true)}>
              Delete account
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
