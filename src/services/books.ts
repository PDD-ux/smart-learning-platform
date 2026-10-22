import { apiRequest } from './api';
import type { BookCommand, BookResult } from '@/lib/books/contracts';
export const books = {
  read:(id:string,start?:number,end?:number):Promise<BookResult>=>apiRequest(`/api/contents/${encodeURIComponent(id)}/book${start===undefined?'':`?start=${start}&end=${end??start}`}`),
  write:(id:string,body:BookCommand):Promise<BookResult>=>apiRequest(`/api/contents/${encodeURIComponent(id)}/book`,{method:'POST',body}),
};
