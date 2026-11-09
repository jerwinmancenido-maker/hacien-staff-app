/** Read lengths as desktop pixels. Phone scale wraps them in calc(Npx * var(--ui-scale, 1)). */
export function desktopCss(css: string): string {
  return css.replace(/calc\((-?(?:\d+\.\d+|\d+|\.\d+)px) \* var\(--ui-scale, 1\)\)/g, "$1");
}
