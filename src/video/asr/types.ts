import type { TranscriptCue } from '../../domain/ir';

export type AsrWorkerCue = Omit<TranscriptCue, 'id'> & { source: 'asr' };

export type AsrWorkerRequest = {
  id: string;
  op: 'transcribe';
  audio_path: string;
  language: string;
  model: string;
  aligner: string;
  device: 'auto' | 'cpu' | 'cuda:0';
};

export type AsrWorkerSuccess = {
  id: string;
  ok: true;
  language: string;
  cues: AsrWorkerCue[];
};

export type AsrWorkerFailure = {
  id: string;
  ok: false;
  code: string;
  message: string;
};

export type AsrWorkerResponse = AsrWorkerSuccess | AsrWorkerFailure;
