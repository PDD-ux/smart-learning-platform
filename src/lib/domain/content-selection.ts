/** Resolve a navigation hint only against the current account's loaded list. */
export function resolveContentSelection(
  contents: readonly { contentId: string }[],
  requested: string | string[] | undefined,
  chooseFirst = false,
): { contentId: string; error: string } {
  if (requested === undefined) return { contentId: chooseFirst ? contents[0]?.contentId ?? '' : '', error: '' };
  if (typeof requested === 'string' && requested.length > 0 && requested.length <= 128 && contents.some((content): boolean => content.contentId === requested)) return { contentId: requested, error: '' };
  return { contentId: '', error: '链接指定的资料不在当前可用列表中，请手动选择本人资料。' };
}
