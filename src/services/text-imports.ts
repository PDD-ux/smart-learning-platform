import {apiRequest} from './api';
import type {PasteCommand,PasteResult} from '@/lib/text-imports/contracts';
export const textImports={submit:(command:PasteCommand):Promise<PasteResult>=>apiRequest('/api/text-imports',{method:'POST',body:command})};
