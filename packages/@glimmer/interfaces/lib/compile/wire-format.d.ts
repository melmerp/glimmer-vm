import { Dict, Option } from '../core';

export type TupleSyntax = Statement | TupleExpression;

type JsonValue = string | number | boolean | JsonObject | JsonArray;

interface JsonObject extends Dict<JsonValue> {}
interface JsonArray extends Array<JsonValue> {}

// This entire file is serialized to disk, so all strings
// end up being interned.
export type str = string;
export type TemplateReference = Option<SerializedBlock>;
export type YieldTo = number;

export const enum SexpOpcodes {
  // Statements
  Text = 0,
  Append = 1,
  Comment = 2,
  Modifier = 3,
  StrictModifier = 4,
  Block = 5,
  StrictBlock = 6,
  Component = 7,
  DynamicComponent = 8,
  OpenElement = 9,
  FlushElement = 10,
  CloseElement = 11,
  StaticAttr = 12,
  DynamicAttr = 13,
  ComponentAttr = 14,
  AttrSplat = 15,
  Yield = 16,
  Partial = 17,

  DynamicArg = 18,
  StaticArg = 19,
  TrustingDynamicAttr = 20,
  TrustingComponentAttr = 21,
  Debugger = 22,

  // Expressions

  Unknown = 23,
  Get = 24,
  GetFree = 25,
  MaybeLocal = 26,
  HasBlock = 27,
  HasBlockParams = 28,
  Undefined = 29,
  Helper = 30,
  Concat = 32,
}

export interface SexpOpcodeMap {
  [index: number]: TupleSyntax;

  [SexpOpcodes.Text]: Statements.Text;
  [SexpOpcodes.Append]: Statements.Append;
  [SexpOpcodes.Comment]: Statements.Comment;
  [SexpOpcodes.Modifier]: Statements.Modifier;
  [SexpOpcodes.Block]: Statements.Block;
  [SexpOpcodes.Component]: Statements.Component;
  [SexpOpcodes.DynamicComponent]: Statements.DynamicComponent;
  [SexpOpcodes.OpenElement]: Statements.OpenElement;
  [SexpOpcodes.FlushElement]: Statements.FlushElement;
  [SexpOpcodes.CloseElement]: Statements.CloseElement;
  [SexpOpcodes.StaticAttr]: Statements.StaticAttr;
  [SexpOpcodes.DynamicAttr]: Statements.DynamicAttr;
  [SexpOpcodes.ComponentAttr]: Statements.ComponentAttr;
  [SexpOpcodes.AttrSplat]: Statements.AttrSplat;
  [SexpOpcodes.Yield]: Statements.Yield;
  [SexpOpcodes.Partial]: Statements.Partial;

  [SexpOpcodes.DynamicArg]: Statements.DynamicArg;
  [SexpOpcodes.StaticArg]: Statements.StaticArg;
  [SexpOpcodes.TrustingDynamicAttr]: Statements.TrustingAttr;
  [SexpOpcodes.TrustingComponentAttr]: Statements.TrustingComponentAttr;
  [SexpOpcodes.Debugger]: Statements.Debugger;

  // Expressions

  [SexpOpcodes.Unknown]: Expressions.Unknown;
  [SexpOpcodes.Get]: Expressions.Get;
  [SexpOpcodes.MaybeLocal]: Expressions.MaybeLocal;
  [SexpOpcodes.HasBlock]: Expressions.HasBlock;
  [SexpOpcodes.HasBlockParams]: Expressions.HasBlockParams;
  [SexpOpcodes.Undefined]: Expressions.Undefined;
  [SexpOpcodes.Helper]: Expressions.Helper;
  [SexpOpcodes.Concat]: Expressions.Concat;
}

export namespace Core {
  export type Expression = Expressions.Expression;

  export type Path = str[];
  export type Params = Expression[];
  export type Hash = Option<[str[], Expression[]]>;
  export type Blocks = Option<[str[], SerializedInlineBlock[]]>;
  export type Args = [Params, Hash];
  export type EvalInfo = number[];
}

export namespace Expressions {
  export type Path = Core.Path;
  export type Params = Core.Params;
  export type Hash = Core.Hash;

  export type Unknown = [SexpOpcodes.Unknown, str];
  export type Get = [SexpOpcodes.Get, number, Path];
  export type GetFree = [SexpOpcodes.GetFree, number, Path];

  /**
   * Ambiguous between a self lookup (when not inside an eval) and
   * a local variable (when used inside of an eval).
   */
  export type MaybeLocal = [SexpOpcodes.MaybeLocal, Path];

  export type Value = str | number | boolean | null;
  export type HasBlock = [SexpOpcodes.HasBlock, YieldTo];
  export type HasBlockParams = [SexpOpcodes.HasBlockParams, YieldTo];
  export type Undefined = [SexpOpcodes.Undefined];

  export type TupleExpression =
    | Unknown
    | Get
    | GetFree
    | MaybeLocal
    | Concat
    | HasBlock
    | HasBlockParams
    | Helper
    | Undefined;

  export type Expression = TupleExpression | Value;

  type Passthru<T> = T;

  export interface Concat extends Passthru<[SexpOpcodes.Concat, Params]> {}

  export interface Helper extends Passthru<[SexpOpcodes.Helper, Expression, Params, Hash]> {}
}

export type Expression = Expressions.Expression;

export type TupleExpression = Expressions.TupleExpression;

export namespace Statements {
  export type Expression = Expressions.Expression;
  export type Params = Core.Params;
  export type Hash = Core.Hash;
  export type Blocks = Core.Blocks;
  export type Path = Core.Path;

  export type Text = [SexpOpcodes.Text, str];
  export type Append = [SexpOpcodes.Append, Expression, boolean];
  export type Comment = [SexpOpcodes.Comment, str];
  export type Modifier = [SexpOpcodes.Modifier, Expression, Params, Hash];
  export type Block = [SexpOpcodes.Block, Expression, Params, Hash, Blocks];
  export type Component = [SexpOpcodes.Component, str, Attribute[], Hash, Blocks];
  export type DynamicComponent = [
    SexpOpcodes.DynamicComponent,
    Expression,
    Attribute[],
    Hash,
    Blocks
  ];
  export type OpenElement = [SexpOpcodes.OpenElement, str, boolean];
  export type FlushElement = [SexpOpcodes.FlushElement];
  export type CloseElement = [SexpOpcodes.CloseElement];
  export type StaticAttr = [SexpOpcodes.StaticAttr, str, str, Option<str>];
  export type DynamicAttr = [SexpOpcodes.DynamicAttr, str, Expression, Option<str>];
  export type ComponentAttr = [SexpOpcodes.ComponentAttr, str, Expression, Option<str>];
  export type AttrSplat = [SexpOpcodes.AttrSplat, YieldTo];
  export type Yield = [SexpOpcodes.Yield, YieldTo, Option<Params>];
  export type Partial = [SexpOpcodes.Partial, Expression, Core.EvalInfo];
  export type DynamicArg = [SexpOpcodes.DynamicArg, str, Expression];
  export type StaticArg = [SexpOpcodes.StaticArg, str, Expression];
  export type TrustingAttr = [SexpOpcodes.TrustingDynamicAttr, str, Expression, str];
  export type TrustingComponentAttr = [SexpOpcodes.TrustingComponentAttr, str, Expression, str];
  export type Debugger = [SexpOpcodes.Debugger, Core.EvalInfo];

  /**
   * A Handlebars statement
   */
  export type Statement =
    | Text
    | Append
    | Comment
    | Modifier
    | Block
    | Component
    | DynamicComponent
    | OpenElement
    | FlushElement
    | CloseElement
    | StaticAttr
    | DynamicAttr
    | ComponentAttr
    | AttrSplat
    | Yield
    | Partial
    | StaticArg
    | DynamicArg
    | TrustingAttr
    | TrustingComponentAttr
    | Debugger;

  export type Attribute =
    | Statements.StaticAttr
    | Statements.DynamicAttr
    | Statements.ComponentAttr
    | Statements.TrustingComponentAttr
    | Statements.Modifier
    | Statements.AttrSplat;

  export type Argument = Statements.StaticArg | Statements.DynamicArg;

  export type Parameter = Attribute | Argument;
}

/** A Handlebars statement */
export type Statement = Statements.Statement;
export type Attribute = Statements.Attribute;
export type Argument = Statements.Argument;
export type Parameter = Statements.Parameter;

export type SexpSyntax = Statement | TupleExpression;
export type Syntax = SexpSyntax | Expressions.Value;

/**
 * A JSON object that the Block was serialized into.
 */
export interface SerializedBlock {
  statements: Statements.Statement[];
}

export interface SerializedInlineBlock extends SerializedBlock {
  parameters: number[];
}

/**
 * A JSON object that the compiled TemplateBlock was serialized into.
 */
export interface SerializedTemplateBlock extends SerializedBlock {
  symbols: string[];
  hasEval: boolean;
  upvars: string[];
}

/**
 * A JSON object that the compiled Template was serialized into.
 */
export interface SerializedTemplate<T> {
  block: SerializedTemplateBlock;
  id?: Option<string>;
  meta: T;
}

/**
 * A string of JSON containing a SerializedTemplateBlock
 */
export type SerializedTemplateBlockJSON = string;

/**
 * A JSON object containing the SerializedTemplateBlock as JSON and TemplateMeta.
 */
export interface SerializedTemplateWithLazyBlock<M> {
  id?: Option<string>;
  block: SerializedTemplateBlockJSON;
  meta: M;
}

/**
 * A string of Javascript containing a SerializedTemplateWithLazyBlock to be
 * concatenated into a Javascript module.
 */
export type TemplateJavascript = string;
