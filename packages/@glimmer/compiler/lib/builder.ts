import {
  WireFormat,
  SerializedTemplate,
  Option,
  Dict,
  SerializedInlineBlock,
  Expressions,
} from '@glimmer/interfaces';

import Op = WireFormat.SexpOpcodes;
import Stmt = WireFormat.Statements;
import Exprs = WireFormat.Expressions;
import Core = WireFormat.Core;
import { dict, assertNever, assert } from '@glimmer/util';
import {
  BuilderStatement,
  TupleBuilderExpression,
  isTupleBuilderExpression,
  BuilderExpression,
  TupleBuilderExpressionMap,
  BuilderHash,
  BuilderBlock,
  BuilderAttrs,
  isElement,
  BuilderElement,
  isAngleInvocation,
  InvocationElement,
  isBlock,
  BuilderBlockStatement,
  BuilderBlocks,
  normalizeBuilderBlockStatement,
  normalizeCall,
  isComment,
  BuilderComment,
} from './builder-interface';
import { AttrNamespace, Namespace } from '@simple-dom/interface';

export type BlockFunction = (b: BlockBuilder) => void;
export type TemplateFunction = (b: TemplateBuilder) => void;
export type InlineBlockFunction = (b: InlineBlockBuilder) => void;
export type AttrsFunction = (b: ElementTagBuilder) => void;
export type ParamsFunction = (b: ComponentCallBuilder) => void;

interface Symbols {
  top: ProgramSymbols;
  freeVar(name: string): number;
  arg(name: string): number;
  block(name: string): number;
  local(name: string): number;

  hasLocal(name: string): boolean;
}

export class ProgramSymbols implements Symbols {
  _freeVariables: string[] = [];
  _symbols: string[] = ['this'];

  top = this;

  toSymbols(): string[] {
    return this._symbols.slice(1);
  }

  toUpvars(): string[] {
    return this._freeVariables;
  }

  freeVar(name: string): number {
    return addString(this._freeVariables, name);
  }

  block(name: string): number {
    return this.symbol(name);
  }

  arg(name: string): number {
    return addString(this._symbols, name);
  }

  local(name: string): never {
    throw new Error(
      `No local ${name} was found. Lookup reached the top-level, which has no locals`
    );
  }

  hasLocal(_name: string): false {
    return false;
  }

  // any symbol
  symbol(name: string): number {
    return addString(this._symbols, name);
  }
}

class LocalSymbols implements Symbols {
  private locals: Dict<number> = dict();

  constructor(private parent: Symbols, locals: string[]) {
    for (let local of locals) {
      this.locals[local] = parent.top.symbol(local);
    }
  }

  get paramSymbols(): number[] {
    return Object.values(this.locals);
  }

  get top(): ProgramSymbols {
    return this.parent.top;
  }

  freeVar(name: string): number {
    return this.parent.freeVar(name);
  }

  arg(name: string): number {
    return this.parent.arg(name);
  }

  block(name: string): number {
    return this.parent.block(name);
  }

  local(name: string): number {
    if (name in this.locals) {
      return this.locals[name];
    } else {
      return this.parent.local(name);
    }
  }

  hasLocal(name: string): boolean {
    if (name in this.locals) {
      return true;
    } else {
      return this.parent.hasLocal(name);
    }
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
      params?: ToExpression[];
      hash?: Dict<ToExpression>;
      locals?: string[];
      blocks: Dict<InlineBlockFunction>;
    }
  | {
      params?: ToExpression[];
      hash?: Dict<ToExpression>;
      locals?: string[];
      block: InlineBlockFunction;
    };

type PathRest = string | string[];

function normalizeTail(input: PathRest): string[] {
  if (typeof input === 'string') {
    return input.split('.');
  } else {
    return input;
  }
}

export interface BuilderGetFree {
  type: 'GetFree';
  head: string;
  tail: string[];
}

type OldBuilderExpression = BuilderGetFree;

type ToExpression = WireFormat.Expression | OldBuilderExpression;

function toExpression(input: ToExpression, symbols: Symbols): WireFormat.Expression {
  if (Array.isArray(input)) {
    return input;
  } else if (input === null) {
    return input;
  } else if (typeof input !== 'object') {
    return input;
  } else {
    switch (input.type) {
      case 'GetFree':
        return [Op.GetPath, [Op.GetFree, symbols.freeVar(input.head)], input.tail];

      default:
        throw new Error(`Unreachable ${input.type}`);
    }
  }
}

function toParams(input: Option<ToExpression[]>, symbols: Symbols): Core.Params {
  if (input === null) return [];

  return input.map(e => toExpression(e, symbols));
}

function toHash(input: Dict<ToExpression> | undefined, symbols: Symbols): Core.Hash {
  if (input === undefined) return null;

  let out: [string[], WireFormat.Expression[]] = [[], []];

  Object.keys(input).forEach(k => {
    out[0].push(k);
    out[1].push(toExpression(input[k], symbols));
  });

  return out;
}

export abstract class Builder {
  protected abstract symbols: Symbols;

  getFree(variable: string, tail: PathRest = []): BuilderGetFree {
    return {
      type: 'GetFree',
      head: variable,
      tail: normalizeTail(tail),
    };
  }

  getArg(variable: string, tail: PathRest = []): Exprs.GetPath {
    return [Op.GetPath, [Op.GetSymbol, this.symbols.arg(variable)], normalizeTail(tail)];
  }

  concat(...values: ToExpression[]): Exprs.Concat {
    let exprs = values.map(v => toExpression(v, this.symbols));
    return [Op.Concat, exprs];
  }

  helper(name: string, params: ToExpression[], hash?: Dict<ToExpression>): Exprs.Helper {
    let wireParams = toParams(params, this.symbols);
    let wireHash = toHash(hash, this.symbols);

    return [Op.Call, [Op.GetFree, this.symbols.freeVar(name)], wireParams, wireHash];
  }
}

export abstract class BlockBuilder extends Builder {
  protected statements: WireFormat.Statement[] = [];

  text(t: string): this {
    this.statements.push([Op.Append, t, true]);
    return this;
  }

  append(e: ToExpression, trusted = false): this {
    let expr = toExpression(e, this.symbols);
    this.statements.push([Op.Append, expr, trusted]);
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

  block(
    name: string,
    { params = [], hash = undefined, locals = [], ...rest }: BlockDefinition
  ): this {
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
      let builder = new InlineBlockBuilder(new LocalSymbols(this.symbols, locals));
      blocks[name](builder);
      list.push(builder.toBlock());
    });

    let wireParams = toParams(params, this.symbols);
    let wireHash = toHash(hash, this.symbols);

    this.statements.push([
      Op.Block,
      [Op.GetFree, this.symbols.freeVar(name)],
      wireParams,
      wireHash,
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

    if (body) body(this);

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

function unimpl(message: string): Error {
  return new Error(`unimplemented ${message}`);
}

export function buildStatements(
  statements: BuilderStatement[],
  symbols: Symbols = new ProgramSymbols()
): WireFormat.Statement[] {
  let out: WireFormat.Statement[] = [];

  statements.forEach(s => out.push(...buildStatement(s, symbols)));

  return out;
}

export function buildStatement(
  statement: BuilderStatement,
  symbols: Symbols = new ProgramSymbols()
): WireFormat.Statement[] {
  if (typeof statement === 'string') {
    switch (statement[0]) {
      case '^': {
        let symbol = symbols.freeVar(statement[0].slice(1));
        return [[Op.Append, [Op.GetPath, [Op.GetFree, symbol], []], false]];
      }

      case '@': {
        let symbol = symbols.arg(statement[0]);
        return [[Op.Append, [Op.GetPath, [Op.GetSymbol, symbol], []], false]];
      }

      default: {
        let symbol = symbols.local(statement[0]);
        return [[Op.Append, [Op.GetPath, [Op.GetSymbol, symbol], []], false]];
      }
    }
  }

  if (isComment(statement)) {
    return [[Op.Comment, statement[1]]];
  } else if (isElement(statement)) {
    return buildElement(statement, symbols);
  } else if (isAngleInvocation(statement)) {
    return [buildAngleInvocation(statement, symbols)];
  } else if (isBlock(statement)) {
    return [buildBlockInvocation(statement, symbols)];
  }

  switch (statement[0]) {
    case 'literal':
      return [[Op.Append, statement[1], true]];

    case 'append':
      return [[Op.Append, buildExpression(statement[1], symbols), statement[2] || false]];

    case 'dynamicComponent':
      throw unimpl('component');

    case 'modifier':
      throw unimpl('modifier');
  }
}

export function s(arr: TemplateStringsArray, ...interpolated: unknown[]): ['literal', string] {
  let result = arr.reduce(
    (result, string, i) => result + `${string}${interpolated[i] ? interpolated[i] : ''}`,
    ''
  ) as string;

  return ['literal', result];
}

export function c(arr: TemplateStringsArray, ...interpolated: unknown[]): BuilderComment {
  let result = arr.reduce(
    (result, string, i) => result + `${string}${interpolated[i] ? interpolated[i] : ''}`,
    ''
  ) as string;

  return ['<!', result];
}

export function unicode(charCode: string): string {
  return String.fromCharCode(parseInt(charCode, 16));
}

export const NEWLINE = '\n';

function buildElement(element: BuilderElement, symbols: Symbols): WireFormat.Statement[] {
  let attrs: BuilderAttrs | null = null;
  let block: BuilderBlock = [];

  let match = element[0].match(/^<([a-z0-9\-]*)>$/);
  let name = match![1];

  if (element.length === 1) {
    // empty element, do nothing
  } else if (element.length === 2) {
    if (Array.isArray(element[1])) {
      block = element[1];
    } else {
      attrs = element[1];
    }
  } else if (element.length === 3) {
    attrs = element[1];
    block = element[2];
  } else {
    throw assertNever(element);
  }

  let out: WireFormat.Statement[] = [[Op.OpenElement, name, !hasSplat(attrs)]];
  if (attrs) {
    let { attributes, args } = buildAttrs(attrs, symbols);
    out.push(...attributes);
    assert(args === null, `Can't pass args to a simple element`);
  }
  out.push([Op.FlushElement]);

  if (Array.isArray(block)) {
    block.forEach(s => out.push(...buildStatement(s, symbols)));
  } else {
    throw assertNever(block);
  }

  out.push([Op.CloseElement]);

  return out;
}

function hasSplat(attrs: Option<BuilderAttrs>): boolean {
  if (attrs === null) return false;

  return Object.keys(attrs).some(a => attrs[a] === 'splat');
}

export function buildAngleInvocation(
  element: InvocationElement,
  symbols: Symbols
): WireFormat.Statements.DynamicComponent {
  let headRaw = element[0];

  let attrs: BuilderAttrs | null = null;
  let block: BuilderBlock = [];

  let match = headRaw.match(/^<(@[a-zA-Z0-9]*|[A-Z][a-zA-Z0-9\-]*)>$/);
  let headExpr = match![1];
  let head = buildExpression(headExpr, symbols);

  if (element.length === 1) {
    // empty element, do nothing
  } else if (element.length === 2) {
    if (Array.isArray(element[1])) {
      block = element[1];
    } else {
      attrs = element[1];
    }
  } else if (element.length === 3) {
    attrs = element[1];
    block = element[2];
  } else {
    throw assertNever(element);
  }

  let attrList: WireFormat.Attribute[] = [];
  let args: WireFormat.Core.Hash = null;
  let blockList: WireFormat.Statement[] = [];

  if (attrs) {
    let built = buildAttrs(attrs, symbols);
    attrList = built.attributes;
    args = built.args;
  }

  if (block) blockList = buildStatements(block, symbols);

  return [
    Op.DynamicComponent,
    head,
    attrList,
    args,
    [['default'], [{ parameters: [], statements: blockList }]],
  ];
}

export function buildAttrs(
  attrs: BuilderAttrs,
  symbols: Symbols
): { attributes: WireFormat.Attribute[]; args: WireFormat.Core.Hash } {
  let attributes: WireFormat.Attribute[] = [];
  let keys: string[] = [];
  let values: WireFormat.Expression[] = [];

  Object.keys(attrs).forEach(key => {
    let value = attrs[key];

    if (value === 'splat') {
      attributes.push([Op.AttrSplat, symbols.block('&attrs')]);
    } else if (key[0] === '@') {
      keys.push(key);
      values.push(buildExpression(value, symbols));
    } else {
      attributes.push(
        ...buildAttributeValue(
          key,
          value,
          // TODO: extract namespace from key
          extractNamespace(key),
          symbols
        )
      );
    }
  });

  return { attributes, args: keys.length === 0 ? null : [keys, values] };
}

export function extractNamespace(name: string): Option<AttrNamespace> {
  if (name === 'xmlns') {
    return Namespace.XMLNS;
  }

  let match = name.match(/^([^:]*):([^:]*)$/);

  if (match === null) {
    return null;
  }

  let namespace = match[1];

  switch (namespace) {
    case 'xlink':
      return Namespace.XLink;
    case 'xml':
      return Namespace.XML;
    case 'xmlns':
      return Namespace.XMLNS;
  }

  return null;
}

export function buildAttributeValue(
  name: string,
  value: BuilderExpression,
  namespace: Option<AttrNamespace>,
  symbols: Symbols
): WireFormat.Attribute[] {
  if (typeof value === 'string') {
    return [[Op.DynamicAttr, name, buildExpression(value, symbols), namespace]];
  } else if (isStringLiteral(value)) {
    return [[Op.StaticAttr, name, value[1], namespace]];
  } else if (value === true) {
    return [[Op.StaticAttr, name, '', namespace]];
  } else if (value === false) {
    return [];
  } else {
    return [[Op.DynamicAttr, name, buildExpression(value, symbols), namespace]];
  }
}

function buildBlockInvocation(
  statement: BuilderBlockStatement,
  symbols: Symbols
): WireFormat.Statements.Block {
  let {
    head: rawHead,
    params: rawParams,
    hash: rawHash,
    blocks: rawBlocks,
  } = normalizeBuilderBlockStatement(statement);

  let blocks = buildBlocks(rawBlocks, symbols);
  let hash = buildHash(rawHash, symbols);
  let params = buildParams(rawParams, symbols);
  let head = buildExpression(rawHead.slice(1), symbols);

  return [Op.Block, head, params, hash, blocks];
}

export function isStringLiteral(value: BuilderExpression): value is ['literal', string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === 'literal' &&
    typeof value[1] === 'string'
  );
}

export function isBooleanLiteral(value: BuilderExpression): value is ['literal', true] {
  return typeof value === 'boolean';
}

export function buildExpression(expr: BuilderExpression, symbols: Symbols): WireFormat.Expression {
  if (isTupleBuilderExpression(expr)) {
    return buildTupleExpression(expr, symbols);
  } else if (typeof expr === 'string') {
    return buildPath(expr, symbols);
  }

  return expr;
}

export function buildTupleExpression(
  expr: TupleBuilderExpression,
  symbols: Symbols
): WireFormat.Expression {
  switch (expr[0]) {
    case 'get': {
      return buildRef(expr, symbols);
    }

    case 'concat': {
      let [, rest] = expr;
      return [Op.Concat, buildParams(rest, symbols)];
    }

    case 'call': {
      let [, func, params, hash] = normalizeCall(expr);

      let builtParams = buildParams(params, symbols);
      let builtHash = buildHash(hash, symbols);
      let builtExpr = buildExpression(func, symbols);

      return [Op.Call, builtExpr, builtParams, builtHash];
    }

    case 'has-block': {
      let [, ref] = expr;
      return [Op.HasBlock, buildExpression(ref, symbols)];
    }

    case 'has-block-params': {
      let [, ref] = expr;
      return [Op.HasBlockParams, buildExpression(ref, symbols)];
    }

    case 'literal': {
      let [, value] = expr;

      if (value === undefined) {
        return [Op.Undefined];
      } else {
        return value;
      }
    }
  }
}

export function buildRef(
  expr: TupleBuilderExpressionMap['get'],
  symbols: Symbols
): WireFormat.Expressions.GetPath {
  let [head, ...tail] = expr[1].split('.');

  return [Op.GetPath, buildVar(head, symbols), tail];
}

export function buildPath(path: string, symbols: Symbols): Expressions.GetPath {
  let [head, ...rest] = path.split('.');
  return [Op.GetPath, buildVar(head, symbols), rest];
}

export function buildVar(
  head: string,
  symbols: Symbols
): Expressions.GetSymbol | Expressions.GetFree {
  switch (head[0]) {
    case '^':
      return [Op.GetFree, symbols.freeVar(head.slice(1))];
    case '@':
      return [Op.GetSymbol, symbols.arg(head)];
    case '&':
      return [Op.GetSymbol, symbols.block(head)];
    default:
      return [Op.GetSymbol, symbols.local(head)];
  }
}

export function buildParams(exprs: BuilderExpression[], symbols: Symbols): WireFormat.Core.Params {
  return exprs.map(e => buildExpression(e, symbols));
}

export function buildHash(exprs: BuilderHash, symbols: Symbols): WireFormat.Core.Hash {
  if (exprs === null) return null;

  let out: [string[], WireFormat.Expression[]] = [[], []];

  Object.keys(exprs).forEach(key => {
    out[0].push(key);
    out[1].push(buildExpression(exprs[key], symbols));
  });

  return out;
}

export function buildBlocks(blocks: BuilderBlocks, symbols: Symbols): WireFormat.Core.Blocks {
  let keys: string[] = [];
  let values: WireFormat.SerializedInlineBlock[] = [];

  Object.keys(blocks).forEach(name => {
    keys.push(name);
    values.push({
      parameters: [],
      statements: buildStatements(blocks[name], symbols),
    });
  });

  return [keys, values];
}

export class TemplateBuilder extends BlockBuilder {
  constructor(protected symbols = new ProgramSymbols()) {
    super();
  }

  toTemplate<T>({ id, meta }: { id: Option<string>; meta: T }): SerializedTemplate<T> {
    return {
      id,
      meta,
      block: {
        symbols: this.symbols.toSymbols(),
        hasEval: false,
        upvars: this.symbols.toUpvars(),
        statements: this.statements,
      },
    };
  }
}

export class InlineBlockBuilder extends BlockBuilder {
  constructor(protected symbols: LocalSymbols) {
    super();
  }

  getLocal(variable: string, tail: PathRest = []): Exprs.GetPath {
    return [Op.GetPath, [Op.GetSymbol, this.symbols.local(variable)], normalizeTail(tail)];
  }

  toBlock(): SerializedInlineBlock {
    return {
      parameters: this.symbols.paramSymbols,
      statements: this.statements,
    };
  }
}

export class AttrBuilder<T extends WireFormat.Attribute | WireFormat.Argument> extends Builder {
  constructor(protected symbols: Symbols, protected attrs: (T | WireFormat.Attribute)[] = []) {
    super();
  }

  attrSplat(): this {
    this.attrs.push([Op.AttrSplat, this.symbols.block('&attrs')]);

    return this;
  }

  attr(name: string, value: ToExpression, ns?: string): this {
    if (typeof value === 'string') {
      this.attrs.push([Op.StaticAttr, name, value, ns || null]);
    } else {
      let expr = toExpression(value, this.symbols);
      this.attrs.push([Op.DynamicAttr, name, expr, ns || null]);
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
