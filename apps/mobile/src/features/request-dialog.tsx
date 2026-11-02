import { Button } from '@/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from '@/ui/dialog';
import { formatBytes } from '@/ui/format';

import { useDemoStore } from './demo-store';
import { personName } from './sample-data';

/** "Blue Rabbit is sending you 2 files": shown when another device asks to send files. */
export function RequestDialog() {
  const { state, acceptRequest, declineRequest } = useDemoStore();
  const request = state.request;
  const person = state.connections.find((c) => c.id === request?.connectionId)?.person;

  if (!request || !person) return null;

  const who = personName(person);
  const total = formatBytes(request.files.reduce((sum, file) => sum + file.size, 0));
  const what =
    request.files.length === 1
      ? `"${request.files[0].name}" (${total})`
      : `${request.files.length} files (${total} total)`;

  return (
    <Dialog visible onRequestClose={declineRequest}>
      <DialogTitle>{`File Transfer request from ${who}`}</DialogTitle>
      <DialogDescription>{`${who} is sending you ${what}. Do you want to accept it?`}</DialogDescription>
      <DialogFooter>
        <Button variant="outline" onPress={declineRequest}>
          Cancel
        </Button>
        <Button onPress={acceptRequest}>Accept</Button>
      </DialogFooter>
    </Dialog>
  );
}
