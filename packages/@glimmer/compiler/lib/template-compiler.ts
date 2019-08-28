import TemplateVisitor, { Action } from './template-visitor';
import JavaScriptCompiler, { Template } from './javascript-compiler';
import { assert, Option } from '@glimmer/util';
import { AST, isLiteral, SyntaxError } from '@glimmer/syntax';
import { getAttrNamespace } from './utils';
import { SymbolAllocator } from './allocate-symbols';
import { PathHead, Processor, InputOps, AllocateSymbolsOps, Ops } from './compiler-ops';
import { DEBUG } from '@glimmer/local-debug-flags';

export interface CompileOptions {
  meta?: unknown;
  customizeComponentName?(tag: string): string;
}

function isTrustedValue(value: any) {
  return value.escaped !== undefined && !value.escaped;
}

export const THIS = 0;

export default class TemplateCompiler implements Processor<InputOps> {
  static compile(ast: AST.Template, options?: CompileOptions): Template {
    let templateVisitor = new TemplateVisitor();
    templateVisitor.visit(ast);

    let compiler = new TemplateCompiler();
    let { opcodes } = compiler.process(templateVisitor.actions);
    let symbols = new SymbolAllocator(opcodes).process();

    let out = JavaScriptCompiler.process(symbols, ast.symbols!, options);

    if (DEBUG) {
      console.log(`Template ->`, out);
    }

    return out;
  }

  constructor() {}

  private templateId = 0;
  private templateIds: number[] = [];
  private opcodes: Ops<AllocateSymbolsOps>[] = [];
  private includeMeta = false;

  process(actions: Action[]): { opcodes: readonly Ops<AllocateSymbolsOps>[] } {
    actions.forEach(([name, args]) => {
      if (!this[name]) {
        throw new Error(`Unimplemented ${name} on TemplateCompiler`);
      }
      this[name](args as any);
    });
    return { opcodes: this.opcodes };
  }

  startProgram([program]: [AST.Template]) {
    this.opcode(['startProgram', program], program);
  }

  endProgram() {
    this.opcode(['endProgram'], null);
  }

  startBlock([program]: [AST.Block]) {
    this.templateId++;
    this.opcode(['startBlock', program], program);
  }

  endBlock() {
    this.templateIds.push(this.templateId - 1);
    this.opcode(['endBlock'], null);
  }

  text([action]: [AST.TextNode]) {
    this.opcode(['text', action.chars], action);
  }

  comment([action]: [AST.CommentStatement]) {
    this.opcode(['comment', action.value], action);
  }

  openElement([action]: [AST.ElementNode]) {
    let attributes = action.attributes;
    let simple = true;

    for (let i = 0; i < attributes.length; i++) {
      let attr = attributes[i];
      if (attr.name === '...attributes') {
        simple = false;
        break;
      }
    }

    if (action.modifiers.length > 0) {
      simple = false;
    }

    let actionIsComponent = false;

    if (isDynamicComponent(action)) {
      let head: PathHead, rest: string[];
      [head, ...rest] = action.tag.split('.');

      this.path(head, rest, action);

      this.opcode(['openComponent', action], action);
      actionIsComponent = true;
    } else if (isNamedBlock(action)) {
      this.opcode(['openNamedBlock', action], action);
    } else if (isComponent(action)) {
      this.opcode(['openComponent', action], action);
      actionIsComponent = true;
    } else {
      this.opcode(['openElement', [action, simple]], action);
    }

    if (!isNamedBlock(action)) {
      // TODO: Assert no attributes
      let typeAttr: Option<AST.AttrNode> = null;
      let attrs = action.attributes;
      for (let i = 0; i < attrs.length; i++) {
        if (attrs[i].name === 'type') {
          typeAttr = attrs[i];
          continue;
        }
        this.attribute([attrs[i]], !simple || actionIsComponent);
      }

      if (typeAttr) {
        this.attribute([typeAttr], !simple || actionIsComponent);
      }

      for (let i = 0; i < action.modifiers.length; i++) {
        this.modifier([action.modifiers[i]]);
      }

      this.opcode(['flushElement', action], null);
    }
  }

  closeElement([action]: [AST.ElementNode]) {
    if (isNamedBlock(action)) {
      this.opcode(['closeNamedBlock', action]);
    } else if (isDynamicComponent(action)) {
      this.opcode(['closeDynamicComponent', action], action);
    } else if (isComponent(action)) {
      this.opcode(['closeComponent', action], action);
    } else {
      this.opcode(['closeElement', action], action);
    }
  }

  attribute([action]: [AST.AttrNode], isComponent: boolean) {
    let { name, value } = action;

    let namespace = getAttrNamespace(name);
    let isStatic = this.prepareAttributeValue(value);

    if (name.charAt(0) === '@') {
      // Arguments
      if (isStatic) {
        this.opcode(['staticArg', name], action);
      } else if (action.value.type === 'MustacheStatement') {
        this.opcode(['dynamicArg', name], action);
      } else {
        this.opcode(['dynamicArg', name], action);
      }
    } else {
      let isTrusting = isTrustedValue(value);

      if (isStatic && name === '...attributes') {
        this.opcode(['attrSplat'], action);
      } else if (isStatic && !isComponent) {
        this.opcode(['staticAttr', [name, namespace]], action);
      } else if (isTrusting) {
        this.opcode(
          isComponent
            ? ['trustingComponentAttr', [name, namespace]]
            : ['trustingAttr', [name, namespace]],
          action
        );
      } else if (action.value.type === 'MustacheStatement') {
        this.opcode(
          isComponent ? ['componentAttr', [name, namespace]] : ['dynamicAttr', [name, namespace]],
          action
        );
      } else {
        this.opcode(
          isComponent ? ['componentAttr', [name, namespace]] : ['dynamicAttr', [name, namespace]],
          action
        );
      }
    }
  }

  modifier([action]: [AST.ElementModifierStatement]) {
    this.prepareHelper(action);
    this.pathExpression(action.path, action);
    this.opcode(['modifier'], action);
  }

  mustache([mustache]: [AST.MustacheStatement]) {
    let { path } = mustache;

    if (isLiteral(path)) {
      this.pathExpression(mustache.path, mustache);
      this.opcode(['append', !mustache.escaped], mustache);
    } else if (path.type !== 'PathExpression') {
      throw new SyntaxError(`Expected PathExpression, got ${path.type}`, path.loc);
    } else if (isYield(path)) {
      let to = assertValidYield(mustache);
      this.yield(to, mustache);
    } else if (isPartial(path)) {
      let params = assertValidPartial(mustache);
      this.partial(params, mustache);
    } else if (isDebugger(path)) {
      assertValidDebuggerUsage(mustache);
      this.debugger('debugger', mustache);
    } else if (isHelperInvocation(mustache)) {
      this.prepareHelper(mustache);
      this.pathExpression(mustache.path, mustache);
      this.opcode(['helper'], mustache);
      this.opcode(['append', !mustache.escaped], mustache);
    } else {
      this.pathExpression(mustache.path, mustache);
      this.opcode(['append', !mustache.escaped], mustache);
    }
  }

  block([action /*, index, count*/]: [AST.BlockStatement]) {
    this.prepareHelper(action);
    let templateId = this.templateIds.pop()!;
    let inverseId = action.inverse === null ? null : this.templateIds.pop()!;
    this.pathExpression(action.path, action);
    this.opcode(['block', [templateId, inverseId]], action);
  }

  /// Internal actions, not found in the original processed actions

  private path(head: string, rest: string[], loc: AST.BaseNode) {
    if (head === 'this') {
      this.thisPath(rest, loc);
    } else if (head[0] === '@') {
      this.argPath(head, rest, loc);
    } else {
      this.varPath(head, rest, loc);
    }
  }

  private argPath(head: string, rest: string[], loc: AST.BaseNode) {
    this.opcode(['getArg', head.slice(1)], loc);
    this.opcode(['getPath', rest], loc);
  }

  private varPath(head: string, rest: string[], loc: AST.BaseNode) {
    this.opcode(['getVar', head], loc);
    this.opcode(['getPath', rest], loc);
  }

  private thisPath(rest: string[], loc: AST.BaseNode) {
    this.opcode(['getThis'], loc);
    this.opcode(['getPath', rest], loc);
  }

  pathExpression(path: AST.Expression, expr: AST.Node) {
    if (isLiteral(path)) {
      this.opcode(['literal', path.value], expr);
    } else if (path.type !== 'PathExpression') {
      throw new SyntaxError(`Expected PathExpression, got ${path.type}`, path.loc);
    } else if (isBuiltInHelper(expr)) {
      this.builtInHelper(expr as AST.Call);
    } else if (path.this) {
      throw new Error(`Unexpected path.this in ${JSON.stringify(path)} in ${JSON.stringify(expr)}`);
    } else {
      let [head, ...rest] = path.parts;
      this.path(head, rest, expr);
    }
    // } else if (isArg(path)) {
    //   this.argPath([path]);
    // } else if (path.this) {
    //   this.opcode(['getThis', path.parts], expr);
    // } else {
    //   let [head, ...parts] = path.parts;
    //   this.opcode(['getVar', [head, parts]], expr);
    // }
  }

  /// Internal Syntax

  yield(to: string, action: AST.MustacheStatement) {
    this.prepareParams(action.params);
    this.opcode(['yield', to], action);
  }

  debugger(_name: string, action: AST.MustacheStatement) {
    this.opcode(['debugger', null], action);
  }

  hasBlock(name: string, action: AST.Call) {
    this.opcode(['hasBlock', name], action);
  }

  hasBlockParams(name: string, action: AST.Call) {
    this.opcode(['hasBlockParams', name], action);
  }

  partial(_params: AST.Expression[], action: AST.MustacheStatement) {
    this.prepareParams(action.params);
    this.opcode(['partial'], action);
  }

  builtInHelper(action: AST.Call) {
    let { path } = action;

    if (isHasBlock(path)) {
      let name = assertValidHasBlockUsage(path.original, action);
      this.hasBlock(name, action);
    } else if (isHasBlockParams(path)) {
      let name = assertValidHasBlockUsage(path.original, action);
      this.hasBlockParams(name, action);
    }
  }

  /// Expressions, invoked recursively from prepareParams and prepareHash

  SubExpression(expr: AST.SubExpression) {
    if (isBuiltInHelper(expr.path)) {
      this.builtInHelper(expr);
    } else {
      this.prepareHelper(expr);
      this.pathExpression(expr.path, expr);
      this.opcode(['helper']);
    }
  }

  PathExpression(expr: AST.PathExpression) {
    let [head, ...rest] = expr.parts;
    this.path(head, rest, expr);
  }

  StringLiteral(action: AST.StringLiteral) {
    this.opcode(['literal', action.value], action);
  }

  BooleanLiteral(action: AST.BooleanLiteral) {
    this.opcode(['literal', action.value], action);
  }

  NumberLiteral(action: AST.NumberLiteral) {
    this.opcode(['literal', action.value], action);
  }

  NullLiteral(action: AST.NullLiteral) {
    this.opcode(['literal', action.value], action);
  }

  UndefinedLiteral(action: AST.UndefinedLiteral) {
    this.opcode(['literal', action.value], action);
  }

  /// Utilities

  opcode<O extends Ops<AllocateSymbolsOps>>(opcode: O, action: Option<AST.BaseNode> = null) {
    // TODO: This doesn't really work
    if (this.includeMeta && action) {
      (opcode as any).push(this.meta(action));
    }

    this.opcodes.push(opcode);
  }

  helperCall(call: AST.Call, node: AST.Node) {
    this.prepareHelper(call);
    this.pathExpression(call.path, node);
    this.opcode(['helper'], node);
  }

  mustacheCall(call: AST.MustacheStatement) {
    this.prepareHelper(call);
    this.pathExpression(call.path, call);
    this.opcode(['helper'], call);
  }

  prepareHelper(expr: AST.Call) {
    assertIsSimplePath(expr.path, expr.loc, 'helper');

    let { params, hash } = expr;

    this.prepareHash(hash);
    this.prepareParams(params);
  }

  prepareParams(params: AST.Expression[]) {
    if (!params.length) {
      this.opcode(['literal', null], null);
      return;
    }

    for (let i = params.length - 1; i >= 0; i--) {
      let param = params[i];

      assert(this[param.type], `Unimplemented ${param.type} on TemplateCompiler`);
      this[param.type](param as any);
    }

    this.opcode(['prepareArray', params.length], null);
  }

  prepareHash(hash: AST.Hash) {
    let pairs = hash.pairs;

    if (!pairs.length) {
      this.opcode(['literal', null], null);
      return;
    }

    for (let i = pairs.length - 1; i >= 0; i--) {
      let { key, value } = pairs[i];

      assert(this[value.type], `Unimplemented ${value.type} on TemplateCompiler`);
      this[value.type](value as any);
      this.opcode(['literal', key], null);
    }

    this.opcode(['prepareObject', pairs.length], null);
  }

  prepareAttributeValue(value: AST.AttrNode['value']): value is AST.TextNode {
    // returns the static value if the value is static

    if (value.type === 'ConcatStatement') {
      this.prepareConcatParts(value.parts);
      this.opcode(['concat'], value);
      return false;
    } else {
      return this.mustacheAttrValue(value);
    }
  }

  prepareConcatParts(parts: AST.ConcatStatement['parts']) {
    for (let i = parts.length - 1; i >= 0; i--) {
      let part = parts[i];

      this.mustacheAttrValue(part);
    }

    this.opcode(['prepareArray', parts.length], null);
  }

  private mustacheAttrValue(value: AST.TextNode | AST.MustacheStatement): value is AST.TextNode {
    if (value.type === 'TextNode') {
      this.opcode(['literal', value.chars]);
      return true;
    } else if (isHelperInvocation(value)) {
      this.prepareHelper(value);
      this.pathExpression(value.path, value);
      this.opcode(['helper'], value);
    } else {
      this.pathExpression(value.path, value);
    }

    return false;
  }

  meta(node: AST.BaseNode) {
    let loc = node.loc;
    if (!loc) {
      return [];
    }

    let { source, start, end } = loc;
    return ['loc', [source || null, [start.line, start.column], [end.line, end.column]]];
  }
}

function isHelperInvocation(
  mustache: AST.Node | AST.Call
): mustache is AST.Call & { path: AST.PathExpression } {
  if (mustache.type !== 'SubExpression' && mustache.type !== 'MustacheStatement') {
    return false;
  }

  return (
    (mustache.params && mustache.params.length > 0) ||
    (mustache.hash && mustache.hash.pairs.length > 0)
  );
}

function isSimplePath({ parts }: AST.PathExpression): boolean {
  return parts.length === 1;
}

function isYield(path: AST.PathExpression) {
  return path.original === 'yield';
}

function isPartial(path: AST.PathExpression) {
  return path.original === 'partial';
}

function isDebugger(path: AST.PathExpression) {
  return path.original === 'debugger';
}

function isHasBlock(path: AST.Expression): path is AST.PathExpression {
  if (path.type !== 'PathExpression') return false;
  return path.original === 'has-block';
}

function isHasBlockParams(path: AST.Expression): path is AST.PathExpression {
  if (path.type !== 'PathExpression') return false;
  return path.original === 'has-block-params';
}

function isBuiltInHelper(node: AST.Node | AST.Call): node is AST.Call {
  if (node.type === 'SubExpression') {
    return isHasBlock(node.path) || isHasBlockParams(node.path);
  } else {
    return false;
  }
}

function isDynamicComponent(element: AST.ElementNode): boolean {
  let open = element.tag.charAt(0);

  let [maybeLocal] = element.tag.split('.');
  let isNamedArgument = open === '@';
  let isLocal = element.symbols!.has(maybeLocal);
  let isThisPath = element.tag.indexOf('this.') === 0;

  return isLocal || isNamedArgument || isThisPath;
}

function isComponent(element: AST.ElementNode): boolean {
  let open = element.tag.charAt(0);
  let isPath = element.tag.indexOf('.') > -1;

  let isUpperCase = open === open.toUpperCase() && open !== open.toLowerCase();

  return (isUpperCase && !isPath) || isDynamicComponent(element);
}

function isNamedBlock(element: AST.ElementNode): boolean {
  let open = element.tag.charAt(0);

  return open === ':';
}

function assertIsSimplePath(path: AST.Expression, loc: AST.SourceLocation, context: string) {
  if (path.type !== 'PathExpression') {
    throw new SyntaxError(
      `\`${path.type}\` is not a valid ${context} on line ${loc.start.line}.`,
      path.loc
    );
  }

  if (!isSimplePath(path)) {
    throw new SyntaxError(
      `\`${path.original}\` is not a valid name for a ${context} on line ${loc.start.line}.`,
      path.loc
    );
  }
}

function assertValidYield(statement: AST.MustacheStatement): string {
  let { pairs } = statement.hash;

  if ((pairs.length === 1 && pairs[0].key !== 'to') || pairs.length > 1) {
    throw new SyntaxError(`yield only takes a single named argument: 'to'`, statement.loc);
  } else if (pairs.length === 1 && pairs[0].value.type !== 'StringLiteral') {
    throw new SyntaxError(`you can only yield to a literal value`, statement.loc);
  } else if (pairs.length === 0) {
    return 'default';
  } else {
    return (pairs[0].value as AST.StringLiteral).value;
  }
}

function assertValidPartial(statement: AST.MustacheStatement) /* : expr */ {
  let { params, hash, escaped, loc } = statement;

  if (params && params.length !== 1) {
    throw new SyntaxError(
      `Partial found with no arguments. You must specify a template name. (on line ${loc.start.line})`,
      statement.loc
    );
  } else if (hash && hash.pairs.length > 0) {
    throw new SyntaxError(
      `partial does not take any named arguments (on line ${loc.start.line})`,
      statement.loc
    );
  } else if (!escaped) {
    throw new SyntaxError(
      `{{{partial ...}}} is not supported, please use {{partial ...}} instead (on line ${loc.start.line})`,
      statement.loc
    );
  }

  return params;
}

function assertValidHasBlockUsage(type: string, call: AST.Call): string {
  let { params, hash, loc } = call;

  if (hash && hash.pairs.length > 0) {
    throw new SyntaxError(`${type} does not take any named arguments`, call.loc);
  }

  if (params.length === 0) {
    return 'default';
  } else if (params.length === 1) {
    let param = params[0];
    if (param.type === 'StringLiteral') {
      return param.value;
    } else {
      throw new SyntaxError(
        `you can only yield to a literal value (on line ${loc.start.line})`,
        call.loc
      );
    }
  } else {
    throw new SyntaxError(
      `${type} only takes a single positional argument (on line ${loc.start.line})`,
      call.loc
    );
  }
}

function assertValidDebuggerUsage(statement: AST.MustacheStatement) {
  let { params, hash } = statement;

  if (hash && hash.pairs.length > 0) {
    throw new SyntaxError(`debugger does not take any named arguments`, statement.loc);
  }

  if (params.length === 0) {
    return 'default';
  } else {
    throw new SyntaxError(`debugger does not take any positional arguments`, statement.loc);
  }
}
