import {
  WireFormat,
  SerializedTemplate,
  Option,
  Dict,
  SerializedInlineBlock,
} from '@glimmer/interfaces';

import Op = WireFormat.SexpOpcodes;
import Stmt = WireFormat.Statements;
import Exprs = WireFormat.Expressions;
import Core = WireFormat.Core;
import { dict } from '@glimmer/util';

export type BlockFunction = (b: BlockBuilder) => void;
export type TemplateFunction = (b: TemplateBuilder) => void;
export type InlineBlockFunction = (b: InlineBlockBuilder) => void;
export type AttrsFunction = (b: ElementTagBuilder) => void;
export type ParamsFunction = (b: ComponentCallBuilder) => void;

class Symbols {
  freeVariables: string[] = [];
  _symbols: string[] = ['this'];

  toSymbols(): string[] {
    return this._symbols.slice(1);
  }

  freeVar(name: string): number {
    return addString(this.freeVariables, name);
  }

  // argument symbol
  symbol(name: string): number {
    return addString(this._symbols, name);
  }

  arg(name: string): number {
    return addString(this._symbols, name);
  }
}

function addString(array: string[], item: string): number {
  let index = array.indexOf(item);

  if (index === -1) {
    index = array.length;
    array.push(item);
    return index;
  } else {
    return index;
  }
}

export type BlockDefinition =
  | {
      params?: Core.Params;
      hash?: Core.Hash;
      blocks: Dict<InlineBlockFunction>;
    }
  | {
      params?: Core.Params;
      hash?: Core.Hash;
      block: InlineBlockFunction;
    };

export class Builder {
  constructor(protected symbols: Symbols = new Symbols()) {}

  getFree(variable: string, rest: string[] = []): Exprs.GetFree {
    return [Op.GetFree, this.symbols.freeVar(variable), rest];
  }

  getArg(variable: string, rest: string[] = []): Exprs.Get {
    return [Op.Get, this.symbols.arg(variable), rest];
  }

  concat(...values: WireFormat.Expression[]): Exprs.Concat {
    return [Op.Concat, values];
  }

  helper(name: string, params: Core.Params, hash: Core.Hash = null): Exprs.Helper {
    return [Op.Helper, [Op.GetFree, this.symbols.freeVar(name), []], params, hash];
  }
}

export class BlockBuilder extends Builder {
  protected statements: WireFormat.Statement[] = [];

  text(t: string): this {
    this.statements.push([Op.Text, t]);
    return this;
  }

  append(e: WireFormat.Expression, trusted = false): this {
    this.statements.push([Op.Append, e, trusted]);
    return this;
  }

  comment(c: string): this {
    this.statements.push([Op.Comment, c]);
    return this;
  }

  modifier(name: string, params: Core.Params, hash: Core.Hash = null): this {
    this.statements.push([Op.Modifier, this.symbols.freeVar(name), params, hash]);
    return this;
  }

  block(name: string, { params = [], hash = null, ...rest }: BlockDefinition): this {
    let names: string[] = [];
    let list: WireFormat.SerializedInlineBlock[] = [];

    let blocks: Dict<InlineBlockFunction>;

    if ('block' in rest) {
      blocks = dict();
      blocks['default'] = rest.block;
    } else {
      blocks = rest.blocks;
    }

    Object.keys(blocks).forEach(name => {
      names.push(name);
      let builder = new InlineBlockBuilder(this.symbols);
      blocks[name](builder);
      list.push(builder.toBlock());
    });

    this.statements.push([
      Op.Block,
      [Op.GetFree, this.symbols.freeVar(name), []],
      params,
      hash,
      [names, list],
    ]);
    return this;
  }

  element(tag: string): this;
  element(tag: string, body: BlockFunction): this;
  element(tag: string, options: { attrs?: AttrsFunction; body?: BlockFunction } | undefined): this;
  element(
    tag: string,
    options: BlockFunction | { attrs?: AttrsFunction; body?: BlockFunction } = {}
  ): this {
    let attrs: AttrsFunction | undefined = undefined;
    let body: BlockFunction | undefined = undefined;

    if (typeof options === 'function') {
      body = options;
    } else if (options !== undefined) {
      attrs = options.attrs;
      body = options.body;
    }

    let element: Stmt.OpenElement = [Op.OpenElement, tag, true];
    this.statements.push(element);
    if (attrs) {
      let builder = new ElementTagBuilder(this.symbols);
      attrs(builder);
      this.statements.push(...builder.toAttrs());
      if (builder.hasSplat()) {
        element[2] = false;
      }
    }
    this.statements.push([Op.FlushElement]);
    if (body) {
      body(this);
    }
    this.statements.push([Op.CloseElement]);

    return this;
  }

  dynamicComponent(
    expr: WireFormat.Expression,
    {
      params: paramsFn,
      blocks = null,
    }: { params?: ParamsFunction; hash?: Option<Core.Hash>; blocks?: Option<Core.Blocks> }
  ): this {
    let attrs: WireFormat.Attribute[] = [];
    let hash: Core.Hash = null;

    if (paramsFn) {
      let builder = new ComponentCallBuilder(this.symbols);
      paramsFn(builder);
      attrs = builder.toAttrs();
      hash = builder.toHash();
    }

    this.statements.push([Op.DynamicComponent, expr, attrs, hash, blocks]);
    return this;
  }

  // Component = 7,
  // DynamicComponent = 8,
  // OpenElement = 9,
  // FlushElement = 10,
  // CloseElement = 11,
  // StaticAttr = 12,
  // DynamicAttr = 13,
  // ComponentAttr = 14,
  // AttrSplat = 15,
  // Yield = 16,
  // Partial = 17,

  // DynamicArg = 18,
  // StaticArg = 19,
  // TrustingDynamicAttr = 20,
  // TrustingComponentAttr = 21,
  // Debugger = 22,

  // // Expressions

  // Unknown = 23,
  // Get = 24,
  // GetFree = 25,
  // MaybeLocal = 26,
  // HasBlock = 27,
  // HasBlockParams = 28,
  // Undefined = 29,
  // Helper = 30,
  // StrictHelper = 31,
  // Concat = 32,
}

export class TemplateBuilder extends BlockBuilder {
  toTemplate<T>({ id, meta }: { id: Option<string>; meta: T }): SerializedTemplate<T> {
    return {
      id,
      meta,
      block: {
        symbols: this.symbols.toSymbols(),
        hasEval: false,
        upvars: this.symbols.freeVariables,
        statements: this.statements,
      },
    };
  }
}

export class InlineBlockBuilder extends BlockBuilder {
  toBlock(): SerializedInlineBlock {
    return {
      parameters: [],
      statements: this.statements,
    };
  }
}

export class AttrBuilder<T extends WireFormat.Attribute | WireFormat.Argument> extends Builder {
  constructor(symbols: Symbols, protected attrs: (T | WireFormat.Attribute)[] = []) {
    super(symbols);
  }

  attrSplat(): this {
    this.attrs.push([Op.AttrSplat, this.symbols.symbol('&attrs')]);

    return this;
  }

  attr(name: string, value: Core.Expression, ns?: string): this {
    if (typeof value === 'string') {
      this.attrs.push([Op.StaticAttr, name, value, ns || null]);
    } else {
      this.attrs.push([Op.DynamicAttr, name, value, ns || null]);
    }

    return this;
  }
}

export class ElementTagBuilder extends AttrBuilder<WireFormat.Attribute> {
  private _hasSplat = false;

  toAttrs(): WireFormat.Attribute[] {
    return this.attrs;
  }

  attrSplat(): this {
    this._hasSplat = true;
    return super.attrSplat();
  }

  hasSplat(): boolean {
    return this._hasSplat;
  }
}

export class ComponentCallBuilder extends AttrBuilder<WireFormat.Parameter> {
  constructor(
    symbols: Symbols,
    protected attrs: WireFormat.Attribute[] = [],
    private hash: [string[], WireFormat.Expression[]] = [[], []]
  ) {
    super(symbols, attrs);
  }

  toAttrs(): WireFormat.Attribute[] {
    return this.attrs;
  }

  toHash(): Core.Hash {
    return this.hash;
  }

  attr(name: string, value: WireFormat.Expression, namespace?: string): this {
    this.attrs.push([Op.ComponentAttr, name, value, namespace || null]);
    return this;
  }

  arg(variable: string, value: WireFormat.Expression): this {
    this.hash[0].push(variable);
    this.hash[1].push(value);
    return this;
  }
}
