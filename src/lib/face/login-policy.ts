export type FaceLoginMode = 'action' | 'scan';

/** Only server configuration selects authentication policy; never trust a client-supplied mode. */
export function faceLoginMode(): FaceLoginMode {
  return process.env.FACE_LOGIN_MODE === 'scan' ? 'scan' : 'action';
}
