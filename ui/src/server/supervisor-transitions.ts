interface PauseOperations {
  markerExists: () => boolean;
  writeMarker: () => void;
  stop: () => void;
  setPaused: () => void;
  removeMarker: () => void;
}

export function performProjectPause(operations: PauseOperations) {
  const markerExisted = operations.markerExists();
  operations.writeMarker();
  try {
    operations.stop();
  } catch (error) {
    if (!markerExisted) {
      try {
        operations.removeMarker();
      } catch {}
    }
    throw error;
  }
  operations.setPaused();
}

interface RestartOperations {
  stop: () => void;
  paused: () => boolean;
  reconcile: (paused: boolean) => void;
  start: () => void;
}

export function performProjectRestart(operations: RestartOperations) {
  operations.stop();
  const paused = operations.paused();
  operations.reconcile(paused);
  if (!paused) operations.start();
}
