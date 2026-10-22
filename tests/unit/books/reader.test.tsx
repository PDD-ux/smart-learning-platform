import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { bookView,type BookState,type BookCommand } from '@/lib/books/contracts';
const service=vi.hoisted(()=>({read:vi.fn(),write:vi.fn()}));
vi.mock('@/services/books',()=>({books:service}));
import { BookReader } from '@/components/study/BookReader';
const state:BookState={version:1,format:'PDF',sourceDigest:'a'.repeat(64),unitKind:'page',unitCount:25,chapters:[{id:'range-1-10',title:'真实第一章',start:1,end:10,origin:'pdf-outline'},{id:'range-11-25',title:'真实第二章',start:11,end:25,origin:'pdf-outline'}],cursor:1,bookmarks:[],units:{},requests:[]};
const page=vi.fn(),block=vi.fn();
function view():ReturnType<typeof render>{return render(<BookReader contentId="book" page={1} onPage={page} onBlock={block}><input aria-label="原阅读区草稿" defaultValue="保留笔记草稿"/></BookReader>);}
beforeEach(():void=>{vi.clearAllMocks();service.read.mockResolvedValue({book:bookView(state,1)});service.write.mockImplementation(async(commandId:string,command:BookCommand):Promise<object>=>({book:bookView({...state,cursor:'position'in command?command.position:1},2)}));});
afterEach(():void=>{cleanup();vi.unstubAllGlobals();});
it('initializes lazily while keeping the original reader instance and independent draft',async():Promise<void>=>{
  service.read.mockResolvedValue({book:null});view();const original=screen.getByLabelText('原阅读区草稿');await screen.findByRole('button',{name:'建立书籍目录'});expect(service.write).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'建立书籍目录'}));await screen.findByText(/已处理 0/);expect(screen.getByLabelText('原阅读区草稿')).toBe(original);expect((original as HTMLInputElement).value).toBe('保留笔记草稿');
});
it('keeps unsaved TOC edits when navigating a chapter and preserves the PDF reader',async():Promise<void>=>{
  view();await screen.findByText(/已处理 0/);fireEvent.click(screen.getByText('校订目录',{exact:true}));fireEvent.change(screen.getByLabelText('章节目录校订'),{target:{value:'我的未保存修改 | 1 | 25'}});fireEvent.click(screen.getByText('目录 · 2 段'));fireEvent.click(screen.getByRole('button',{name:/真实第二章/}));await waitFor(():void=>expect(page).toHaveBeenCalledWith(11));expect((screen.getByLabelText('章节目录校订') as HTMLTextAreaElement).value).toBe('我的未保存修改 | 1 | 25');expect((screen.getByLabelText('原阅读区草稿') as HTMLInputElement).value).toBe('保留笔记草稿');
});
it('preserves a failed extraction range and reuses the request key on explicit retry',async():Promise<void>=>{
  service.write.mockRejectedValueOnce(new Error('网络失败'));view();await screen.findByText(/已处理 0/);fireEvent.change(screen.getByLabelText('提取结束页'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:'提取选段正文'}));await screen.findByRole('alert');expect(service.write).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'提取选段正文'}));await screen.findByText(/选段正文已保存/);expect(service.write.mock.calls[0][1]).toEqual(service.write.mock.calls[1][1]);expect((screen.getByLabelText('提取结束页') as HTMLInputElement).value).toBe('3');
});
it('blocks oversized ranges before sending and never manufactures processed counts',async():Promise<void>=>{
  view();await screen.findByText(/已处理 0/);fireEvent.change(screen.getByLabelText('提取结束页'),{target:{value:'25'}});fireEvent.click(screen.getByRole('button',{name:'提取选段正文'}));await screen.findByRole('alert');expect(service.write).not.toHaveBeenCalled();expect(screen.getByText(/已处理 0/)).toBeTruthy();
});
it('does not replace a dirty directory on re-read without confirmation',async():Promise<void>=>{
  const confirm=vi.fn(():boolean=>false);vi.stubGlobal('confirm',confirm);view();await screen.findByText(/已处理 0/);fireEvent.click(screen.getByText('校订目录',{exact:true}));fireEvent.change(screen.getByLabelText('章节目录校订'),{target:{value:'草稿'}});fireEvent.click(screen.getByRole('button',{name:'重新读取书籍状态'}));expect(confirm).toHaveBeenCalledOnce();expect(service.read).toHaveBeenCalledTimes(1);expect((screen.getByLabelText('章节目录校订') as HTMLTextAreaElement).value).toBe('草稿');
});
it('shows literal text and original paragraph positions without executing embedded HTML',async():Promise<void>=>{
  service.read.mockResolvedValue({book:bookView({...state,format:'MD',unitKind:'paragraph',unitCount:2,units:{'1':{text:'<img src=x onerror=alert(1)>',status:'text'}}},1)});view();await screen.findByText('<img src=x onerror=alert(1)>');expect(document.querySelector('img')).toBeNull();expect(block).toHaveBeenCalledWith(0);expect(screen.getByText('第 1 段')).toBeTruthy();
});
it('preserves a dirty directory when a source citation changes the displayed paragraph',async():Promise<void>=>{
  service.read.mockImplementation(async(_id:string,start?:number,end?:number):Promise<object>=>({book:bookView({...state,format:'MD',unitKind:'paragraph'},1,start??1,end??20)}));
  const rendered=view();await screen.findByText(/已处理 0/);fireEvent.click(screen.getByText('校订目录',{exact:true}));fireEvent.change(screen.getByLabelText('章节目录校订'),{target:{value:'引用跳转也保留草稿'}});
  rendered.rerender(<BookReader contentId="book" page={1} initialBlock={2} onPage={page} onBlock={block}><input aria-label="原阅读区草稿"/></BookReader>);
  await waitFor(():void=>expect(block).toHaveBeenCalledWith(2));expect((screen.getByLabelText('章节目录校订') as HTMLTextAreaElement).value).toBe('引用跳转也保留草稿');
});
it('keeps the original document reader available when metadata cannot be read',async():Promise<void>=>{
  service.read.mockRejectedValue(new Error('目录暂不可用'));view();await screen.findByRole('alert');expect((screen.getByLabelText('原阅读区草稿') as HTMLInputElement).value).toBe('保留笔记草稿');expect(service.write).not.toHaveBeenCalled();
});

it('reads EPUB literal paragraphs without pretending they are pages or rendering the archive',async():Promise<void>=>{
  service.read.mockResolvedValue({book:bookView({...state,format:'EPUB',unitKind:'paragraph',unitCount:2,units:{'1':{text:'安全的EPUB正文',status:'text'}}},1)});view();await screen.findByText('安全的EPUB正文');
  expect(screen.getByText(/EPUB按书内阅读顺序/)).toBeTruthy();expect(screen.queryByLabelText('原阅读区草稿')).toBeNull();expect(document.querySelector('iframe')).toBeNull();
});
