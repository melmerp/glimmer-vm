import { ExpressionCompilers } from './compilers';
import { SexpOpcodes, ResolveHandle, Op, Expressions } from '@glimmer/interfaces';
import { op } from '../opcode-builder/encoder';
import { helper, pushPrimitiveReference } from '../opcode-builder/helpers/vm';
import { assert } from '@glimmer/util';
import { curryComponent } from '../opcode-builder/helpers/components';
import { expectString } from '../utils';

export const EXPRESSIONS = new ExpressionCompilers();

EXPRESSIONS.add(SexpOpcodes.Concat, ([, parts]) => {
  let out = [];

  for (let part of parts) {
    out.push(op('Expr', part));
  }

  out.push(op(Op.Concat, parts.length));

  return out;
});

EXPRESSIONS.add(SexpOpcodes.Call, ([, name, params, hash], meta) => {
  // TODO: triage this in the WF compiler
  if (name === 'component') {
    assert(
      params && params.length,
      'SYNTAX ERROR: component helper requires at least one argument'
    );

    let [definition, ...restArgs] = params as Expressions.Expression[];
    return curryComponent(
      {
        definition,
        params: restArgs,
        hash,
        atNames: false,
      },
      meta.referrer
    );
  }

  return op('IfResolved', {
    kind: ResolveHandle.Helper,
    name: expectString(name, meta, 'Expected call head to be a string'),
    andThen: handle => helper({ handle, params, hash }),
  });
});

EXPRESSIONS.add(SexpOpcodes.GetSymbol, ([, head]) => [op(Op.GetVariable, head)]);

EXPRESSIONS.add(SexpOpcodes.GetPath, ([, head, tail]) => {
  return [op('Expr', head), ...tail.map(p => op(Op.GetProperty, p))];
});

EXPRESSIONS.add(SexpOpcodes.GetFree, ([, head]) => op('ResolveFree', head));

EXPRESSIONS.add(SexpOpcodes.GetContextualFree, ([, head, context]) =>
  op('ResolveContextualFree', { freeVar: head, context })
);

EXPRESSIONS.add(SexpOpcodes.Undefined, () => pushPrimitiveReference(undefined));
EXPRESSIONS.add(SexpOpcodes.HasBlock, ([, symbol]) => {
  return [op('Expr', symbol), op(Op.HasBlock)];
});

EXPRESSIONS.add(SexpOpcodes.HasBlockParams, ([, symbol]) => [
  op('Expr', symbol),
  op(Op.GetBlock),
  op('JitCompileBlock'),
  op(Op.HasBlockParams),
]);
