// bwip-js ships its Node typings under the "node" export condition, which
// moduleResolution "Bundler" doesn't select. Declare the one function we use.
declare module "bwip-js" {
  export function toSVG(options: {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: string;
  }): string;
}
