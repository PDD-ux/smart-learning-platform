import { homeworkHandlers } from '@/lib/homework/routes';
export const runtime='nodejs';
const handlers=homeworkHandlers();
export const GET=handlers.LIST;
export const POST=handlers.CREATE;
