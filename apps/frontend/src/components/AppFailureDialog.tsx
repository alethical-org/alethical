import { Modal } from 'react-native';
import { AppFailureView } from './AppErrorBoundary';

export function AppFailureDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal visible onRequestClose={onClose}>
      <AppFailureView onClose={onClose} />
    </Modal>
  );
}
