import type { PropsWithChildren } from 'react';
import { Modal, View } from 'react-native';

import { radius, useTheme } from '@/theme/theme';

import { Text } from './text';

type Props = PropsWithChildren<{
  visible: boolean;
  onRequestClose: () => void;
}>;

/** A centred confirmation dialog (the web app's AlertDialog): dark overlay, bordered card. */
export function Dialog({ visible, onRequestClose, children }: Props) {
  const t = useTheme();

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onRequestClose}
      statusBarTranslucent>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: 24,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
        }}>
        <View
          style={{
            gap: 16,
            padding: 24,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.background,
          }}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function DialogTitle({ children }: { children: string }) {
  return (
    <Text size={18} weight="600" style={{ textAlign: 'center' }}>
      {children}
    </Text>
  );
}

export function DialogDescription({ children }: { children: string }) {
  return (
    <Text tone="muted" style={{ textAlign: 'center', lineHeight: 20 }}>
      {children}
    </Text>
  );
}

export function DialogFooter({ children }: PropsWithChildren) {
  return <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>{children}</View>;
}
