import { withAuth } from '@/lib/auth/middleware';
import { readBook, writeBook } from '@/lib/books/service';

// One private adapter keeps both success and authentication/validation failures non-cacheable.
import { fail } from '@/lib/api/response';
const read=withAuth<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>readBook(request,user,params.id));
const write=withAuth<{params:{id:string}}>(async(request,{user,params}):Promise<Response>=>writeBook(request,user,params.id));
function privateResponse(handler:typeof read):typeof read {
  return async(request,context):Promise<Response>=>{
    let response:Response;
    try{response=await handler(request,context);}catch{response=fail('INTERNAL','书籍请求暂不可用，请保留输入后重试。',500);}
    response.headers.set('Cache-Control','private, no-store');
    response.headers.set('Vary','Cookie, Authorization');
    return response;
  };
}
export const GET=privateResponse(read);
export const POST=privateResponse(write);
