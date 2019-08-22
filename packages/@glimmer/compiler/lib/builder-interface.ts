import { Dict, Option } from '@glimmer/interfaces';
import { dict } from '@glimmer/util';

export type BuilderParams = BuilderExpression[];
export type BuilderHash = Option<Dict<BuilderExpression>>;
export type BuilderBlocks = Dict<BuilderBlock>;
export type BuilderAttrs = Dict<BuilderAttr>;

export interface BuilderStatementMap {
  literal: ['literal', string];
  append: ['append', BuilderExpression, true] | ['append', BuilderExpression];
  modifier: ['modifier', BuilderParams, BuilderHash];
  dynamicComponent: ['dynamicComponent', BuilderExpression, BuilderHash, BuilderBlock];
}

export type BuilderBlockStatement =
  | [InvocationHead, BuilderBlock | BuilderBlocks]
  | [InvocationHead, BuilderParams, BuilderBlock | BuilderBlocks]
  | [InvocationHead, BuilderHash, BuilderBlock | BuilderBlocks]
  | [InvocationHead, BuilderParams, BuilderHash, BuilderBlock | BuilderBlocks];

export interface NormalizedBuilderBlockStatement {
  head: InvocationHead;
  params: BuilderParams;
  hash: BuilderHash;
  blocks: BuilderBlocks;
}

export function normalizeBuilderBlockStatement(
  statement: BuilderBlockStatement
): NormalizedBuilderBlockStatement {
  let head = statement[0];
  let blocks: BuilderBlocks = dict();
  let params: BuilderParams = [];
  let hash: BuilderHash = null;

  if (statement.length === 2) {
    blocks = normalizeBlocks(statement[1]);
  } else if (statement.length === 3) {
    if (Array.isArray(statement[1])) {
      params = statement[1];
    } else {
      hash = statement[1];
    }

    blocks = normalizeBlocks(statement[2]);
  } else if (statement.length === 4) {
    params = statement[1];
    hash = statement[2];
    blocks = normalizeBlocks(statement[3]);
  }

  return { head, params, hash, blocks };
}

function normalizeBlocks(value: BuilderBlock | BuilderBlocks): BuilderBlocks {
  if (Array.isArray(value)) {
    return { default: value };
  } else {
    return value;
  }
}

export type BuilderElement =
  | [string]
  | [string, BuilderAttrs, BuilderBlock]
  | [string, BuilderBlock]
  | [string, BuilderAttrs];

export type BuilderComment = ['<!', string];

export type InvocationHead = string;

export type InvocationElement =
  | [InvocationHead]
  | [InvocationHead, BuilderAttrs, BuilderBlock]
  | [InvocationHead, BuilderBlock]
  | [InvocationHead, BuilderAttrs];

export function isElement(input: [string, ...unknown[]]): input is BuilderElement {
  let match = input[0].match(/^<([a-z0-9\-]*)>$/);

  return !!match && !!match[1];
}

export function isComment(input: [string, ...unknown[]]): input is BuilderComment {
  return input[0] === '<!';
}

export function extractAngleInvocation(input: string): Option<string> {
  let match = input[0].match(/^<(@[a-zA-Z0-9]*|[A-Z][a-zA-Z0-9\-]*)>$/);

  return match ? match[1] : null;
}

export function isAngleInvocation(input: [string, ...unknown[]]): input is InvocationElement {
  // TODO: Paths
  let match = input[0].match(/^<(@[a-zA-Z0-9]*|[A-Z][a-zA-Z0-9\-]*)>$/);

  return !!match && !!match[1];
}

export function isBlock(input: [string, ...unknown[]]): input is BuilderBlockStatement {
  // TODO: Paths
  let match = input[0].match(/^#[^]?([a-zA-Z0-9]*|[A-Z][a-zA-Z0-9\-]*)$/);

  return !!match && !!match[1];
}

export type BuilderStatement =
  | BuilderStatementMap[keyof BuilderStatementMap]
  | BuilderElement
  | BuilderComment
  | BuilderBlockStatement
  | string;

export type BuilderAttr = 'splat' | BuilderExpression;

export interface TupleBuilderExpressionMap {
  literal: ['literal', string | boolean | undefined];
  get: ['get', string] | ['get', string, string[]];
  call: FullCall | MiniCall;
  concat: Concat;
  'has-block': ['has-block', string];
  'has-block-params': ['has-block-params', string];
}

type Recursive<T> = T;

export interface FullCall
  extends Recursive<['call', BuilderExpression, BuilderParams, BuilderHash]> {}

export interface MiniCall extends Recursive<['call', BuilderExpression, BuilderParams]> {}

export type Call = FullCall | MiniCall;

export function normalizeCall(call: Call): FullCall {
  if (call.length === 4) {
    return call;
  } else {
    return [call[0], call[1], call[2], null];
  }
}

interface Concat extends Recursive<['concat', BuilderParams]> {}

export type TupleBuilderExpression = TupleBuilderExpressionMap[keyof TupleBuilderExpressionMap];

export type BuilderExpression = TupleBuilderExpression | null | boolean | string | number;

export function isTupleBuilderExpression(expr: BuilderExpression): expr is TupleBuilderExpression {
  return Array.isArray(expr);
}

export interface MiniBuilderBlock extends Recursive<BuilderStatement[]> {}

export type BuilderBlock = MiniBuilderBlock;
