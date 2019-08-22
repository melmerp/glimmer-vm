import {
  precompile,
  WireFormatBuilder,
  WireFormatDebugger,
  InlineBlockBuilder,
  BuilderStatement,
  ProgramSymbols,
  buildStatements,
  s,
  c,
  NEWLINE,
  unicode,
} from '@glimmer/compiler';
import {
  SerializedTemplateWithLazyBlock,
  SerializedTemplate,
  SerializedTemplateBlock,
} from '@glimmer/interfaces';
import { assign, strip } from '@glimmer/util';
import { Namespace } from '@simple-dom/interface';

QUnit.module('@glimmer/compiler - compiling source to wire format');

function compile(content: string): SerializedTemplate<unknown> {
  let parsed = (JSON.parse(
    precompile(content, { meta: null })
  ) as unknown) as SerializedTemplateWithLazyBlock<unknown>;
  let block = JSON.parse(parsed.block);

  return assign({}, parsed, { block });
}

function test1(desc: string, template: string, expectedFn: (b: WireFormatBuilder) => void) {
  QUnit.skip(desc, assert => {
    let actual = compile(template);

    let builder = new WireFormatBuilder();
    expectedFn(builder);

    let expected = builder.toTemplate({ meta: null, id: null });

    let debugExpected = new WireFormatDebugger(expected.block).format();
    let debugActual = new WireFormatDebugger(actual.block).format();

    assert.deepEqual(debugActual, debugExpected);
  });
}

function test(desc: string, template: string, ...expectedStatements: BuilderStatement[]) {
  QUnit.test(desc, assert => {
    let actual = compile(template);

    let symbols = new ProgramSymbols();

    let statements = buildStatements(expectedStatements, symbols);

    let expected: SerializedTemplateBlock = {
      symbols: symbols.toSymbols(),
      hasEval: false,
      upvars: symbols.toUpvars(),
      statements,
    };

    let debugExpected = new WireFormatDebugger(expected).format();
    let debugActual = new WireFormatDebugger(actual.block).format();

    assert.deepEqual(debugActual, debugExpected);
  });
}

test('HTML text content', 'content', s`content`);

test('Text curlies', '<div>{{title}}<span>{{title}}</span></div>', [
  '<div>',
  [['append', '^title'], ['<span>', [['append', '^title']]]],
]);

// test(
//   'Smoke test (integration, basic)',
//   '<div ...attributes><@foo @staticNamedArg="static" data-test1={{@outerArg}} data-test2="static" @dynamicNamedArg={{@outerArg}} /></div>',
//   [
//     '<div>',
//     { attributes: 'splat' },
//     [
//       [
//         `<@foo>`,`
//         {
//           '@staticNamedArg': s`static`,
//           'data-test1': '@outerArg',
//           'data-test2': s`static`,
//           '@dynamicNamedArg': `@outerArg`,
//         },
//       ],
//     ],
//   ]
// );

test(
  'elements',
  '<h1>hello!</h1><div>content</div>',
  ['<h1>', [s`hello!`]],
  ['<div>', [s`content`]]
);

test('attributes', "<div class='foo' id='bar'>content</div>", [
  '<div>',
  { class: s`foo`, id: s`bar` },
  [s`content`],
]);

test('data attributes', "<div data-some-data='foo'>content</div>", [
  '<div>',
  { 'data-some-data': s`foo` },
  [s`content`],
]);

test('checked attributes', "<input checked='checked'>", ['<input>', { checked: s`checked` }]);

test(
  'selected options',
  strip`
     <select>
       <option>1</option>
       <option selected>2</option>
       <option>3</option>
     </select>`,
  [
    '<select>',
    [
      s`${NEWLINE}  `,
      ['<option>', [s`1`]],
      s`${NEWLINE}  `,
      ['<option>', { selected: true }, [s`2`]],
      s`${NEWLINE}  `,
      ['<option>', [s`3`]],
      s`${NEWLINE}`,
    ],
  ]
);

test(
  'multi-select options',
  strip`
     <select multiple>
       <option>1</option>
       <option selected>2</option>
       <option selected>3</option>
     </select>`,

  [
    '<select>',
    { multiple: true },
    [
      s`${NEWLINE}  `,
      ['<option>', [s`1`]],
      s`${NEWLINE}  `,
      ['<option>', { selected: true }, [s`2`]],
      s`${NEWLINE}  `,
      ['<option>', { selected: true }, [s`3`]],
      s`${NEWLINE}`,
    ],
  ]
);

let voidElements = 'area base br embed hr img input keygen link meta param source track wbr';
voidElements.split(' ').forEach(tagName => {
  test(`void ${tagName}`, `<${tagName}>`, [`<${tagName}>`, []]);
});

test(
  'nested HTML',
  "<div class='foo'><p><span id='bar' data-foo='bar'>hi!</span></p></div>&nbsp;More content",
  [
    '<div>',
    { class: s`foo` },
    [['<p>', [['<span>', { id: s`bar`, 'data-foo': s`bar` }, [s`hi!`]]]]],
  ],
  s`${unicode('00a0')}More content`
);

test('custom elements', '<use-the-platform></use-the-platform>', ['<use-the-platform>']);

test(
  'nested custom elements',
  "<use-the-platform><seriously-please data-foo='1'>Stuff <div>Here</div></seriously-please></use-the-platform>",
  [
    '<use-the-platform>',
    [['<seriously-please>', { 'data-foo': s`1` }, [s`Stuff `, ['<div>', [s`Here`]]]]],
  ]
);

test(
  'moar nested Custom Elements',
  "<use-the-platform><seriously-please data-foo='1'><wheres-the-platform>Here</wheres-the-platform></seriously-please></use-the-platform>",
  [
    '<use-the-platform>',
    [['<seriously-please>', { 'data-foo': s`1` }, [['<wheres-the-platform>', [s`Here`]]]]],
  ]
);

test(
  'Custom Elements with dynamic attributes',
  "<fake-thing><other-fake-thing data-src='extra-{{someDynamicBits}}-here' /></fake-thing>",
  [
    '<fake-thing>',
    [['<other-fake-thing>', { 'data-src': ['concat', [s`extra-`, '^someDynamicBits', s`-here`]] }]],
  ]
);

test('Custom Elements with dynamic content', '<x-foo><x-bar>{{derp}}</x-bar></x-foo>', [
  '<x-foo>',
  [['<x-bar>', ['^derp']]],
]);

test('helpers', '<div>{{testing title}}</div>', [
  '<div>',
  [['append', ['call', '^testing', ['^title'], null]]],
]);

test(
  'Dynamic content within single custom element',
  '<x-foo>{{#if param name=hash}}Content Here{{parent}}{{/if}}</x-foo>',
  ['<x-foo>', [['#^if', ['^param'], { name: '^hash' }, [s`Content Here`, '^parent']]]]
);

test('quotes in HTML', `<div>"This is a title," we're on a boat</div>`, [
  '<div>',
  [s`"This is a title," we're on a boat`],
]);

test('backslashes in HTML', `<div>This is a backslash: \\</div>`, [
  '<div>',
  [s`This is a backslash: \\`],
]);

test('newlines in HTML', `<div>common\n\nbro</div>`, ['<div>', [s`common\n\nbro`]]);

test('empty attributes', `<div class=''>content</div>`, ['<div>', { class: s`` }, [s`content`]]);

test('helpers in string attributes', `<a href="http://{{testing 123}}/index.html">linky</a>`, [
  '<a>',
  { href: ['concat', [s`http://`, ['call', '^testing', [123]], s`/index.html`]] },
  [s`linky`],
]);

test(`boolean attribute 'disabled'`, '<input disabled>', ['<input>', { disabled: true }]);

test(`string quoted attributes`, `<input disabled="{{isDisabled}}">`, [
  '<input>',
  { disabled: ['concat', ['^isDisabled']] },
]);

test(`unquoted attributes`, `<img src={{src}}>`, ['<img>', { src: '^src' }]);

test(`dynamic attr followed by static attr`, `<div foo='{{funstuff}}' name='Alice'></div>`, [
  '<div>',
  { foo: ['concat', ['^funstuff']], name: s`Alice` },
]);

test(
  `dynamic selected options`,
  strip`
    <select>
      <option>1</option>
      <option selected={{selected}}>2</option>
      <option>3</option>
    </select>`,
  [
    '<select>',
    [
      s`\n  `,
      ['<option>', [s`1`]],
      s`\n  `,
      ['<option>', { selected: '^selected' }, [s`2`]],
      s`\n  `,
      ['<option>', [s`3`]],
      s`\n`,
    ],
  ]
);

test(
  `dynamic multi-select`,
  strip`
      <select multiple>
        <option>0</option>
        <option selected={{somethingTrue}}>1</option>
        <option selected={{somethingTruthy}}>2</option>
        <option selected={{somethingUndefined}}>3</option>
        <option selected={{somethingNull}}>4</option>
        <option selected={{somethingFalse}}>5</option>
      </select>`,
  [
    '<select>',
    { multiple: true },
    [
      s`\n  `,
      ['<option>', [s`0`]],
      s`\n  `,
      ['<option>', { selected: '^somethingTrue' }, [s`1`]],
      s`\n  `,
      ['<option>', { selected: '^somethingTruthy' }, [s`2`]],
      s`\n  `,
      ['<option>', { selected: '^somethingUndefined' }, [s`3`]],
      s`\n  `,
      ['<option>', { selected: '^somethingNull' }, [s`4`]],
      s`\n  `,
      ['<option>', { selected: '^somethingFalse' }, [s`5`]],
      s`\n`,
    ],
  ]
);

test('HTML comments', `<div><!-- Just passing through --></div>`, [
  '<div>',
  [c` Just passing through `],
]);

test('curlies in HTML comments', `<div><!-- {{foo}} --></div>`, ['<div>', [c` {{foo}} `]]);

test('complex curlies in HTML comments', `<div><!-- {{foo bar baz}} --></div>`, [
  '<div>',
  [c` {{foo bar baz}} `],
]);

test(
  'handlebars blocks in HTML comments',
  `<div><!-- {{#each foo as |bar|}}\n{{bar}}\n\n{{/each}} --></div>`,
  ['<div>', [c` {{#each foo as |bar|}}\n{{bar}}\n\n{{/each}} `]]
);

test('top-level comments', `<!-- {{foo}} -->`, c` {{foo}} `);

test('handlebars comments', `<div>{{! Better not break! }}content</div>`, ['<div>', [s`content`]]);

test('namespaced attribute', `<svg xlink:title='svg-title'>content</svg>`, [
  '<svg>',
  { 'xlink:title': s`svg-title` },
  [s`content`],
]);

test(
  'svg href attribute with quotation marks',
  `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="{{iconLink}}"></use></svg>`,
  [
    '<svg>',
    { 'xmlns:xlink': s`http://www.w3.org/1999/xlink` },
    [['<use>', { 'xlink:href': ['concat', ['^iconLink']] }]],
  ]
);

test(
  'svg href attribute without quotation marks',
  `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href={{iconLink}}></use></svg>`,

  [
    '<svg>',
    { 'xmlns:xlink': s`http://www.w3.org/1999/xlink` },
    [['<use>', { 'xlink:href': '^iconLink' }]],
  ]
);

test('<svg> tag with case-sensitive attribute', '<svg viewBox="0 0 0 0"></svg>', [
  '<svg>',
  { viewBox: s`0 0 0 0` },
]);

{
  let d = 'M 0 0 L 100 100';

  test('nested element in the SVG namespace', `<svg><path d="${d}"></path></svg>`, [
    '<svg>',
    [['<path>', { d: s`${d}` }]],
  ]);

  // b =>
  //   b.element('svg', b =>
  //     b.element('path', {
  //       attrs: b => b.attr('d', d),
  //     })
  //   )
  // );
}

test1(`<foreignObject> tag is case-sensitive`, `<svg><foreignObject>Hi</foreignObject></svg>`, b =>
  b.element('svg', b => b.element('foreignObject', b => b.text('Hi')))
);

test1('svg alongside non-svg', `<svg></svg><svg></svg><div></div>`, b =>
  b
    .element('svg')
    .element('svg')
    .element('div')
);

test1('svg nested in a div', `<div><svg></svg></div><div></div>`, b =>
  b.element('div', b => b.element('svg')).element('div')
);

test1(
  'linearGradient preserves capitalization',
  `<svg><linearGradient id="gradient"></linearGradient></svg>`,
  b =>
    b.element('svg', b =>
      b.element('linearGradient', {
        attrs: b => b.attr('id', 'gradient'),
      })
    )
);

test1('curlies separated by content whitespace', `{{a}} {{b}}`, b =>
  b
    .append(b.getFree('a'))
    .text(' ')
    .append(b.getFree('b'))
);

test1('curlies right next to each other', `<div>{{a}}{{b}}{{c}}wat{{d}}</div>`, b =>
  b.element('div', b =>
    b
      .append(b.getFree('a'))
      .append(b.getFree('b'))
      .append(b.getFree('c'))
      .text('wat')
      .append(b.getFree('d'))
  )
);

test1('paths', `<div>{{model.foo.bar}}<span>{{model.foo.bar}}</span></div>`, b =>
  b.element('div', b =>
    b
      .append(b.getFree('model', 'foo.bar'))
      .element('span', b => b.append(b.getFree('model', 'foo.bar')))
  )
);

test1('whitespace', `Hello {{ foo }} `, b =>
  b
    .text('Hello ')
    .append(b.getFree('foo'))
    .text(' ')
);

test1('double curlies', `<div>{{title}}</div>`, b =>
  b.element('div', b => b.append(b.getFree('title')))
);

test1('triple curlies', `<div>{{{title}}}</div>`, b =>
  b.element('div', b => b.append(b.getFree('title'), true))
);

test1(
  'triple curly helpers',
  `{{{unescaped "<strong>Yolo</strong>"}}} {{escaped "<strong>Yolo</strong>"}}`,
  b =>
    b
      .append(b.helper('unescaped', ['<strong>Yolo</strong>']), true)
      .text(' ')
      .append(b.helper('escaped', ['<strong>Yolo</strong>']))
);

test1('top level triple curlies', `{{{title}}}`, b => b.append(b.getFree('title'), true));

test1('top level table', `<table>{{{title}}}</table>`, b =>
  b.element('table', b => b.append(b.getFree('title'), true))
);

test1(
  'X-TREME nesting',
  `{{foo}}<span>{{bar}}<a>{{baz}}<em>{{boo}}{{brew}}</em>{{bat}}</a></span><span><span>{{flute}}</span></span>{{argh}}`,
  b =>
    b
      .append(b.getFree('foo'))
      .element('span', b =>
        b.append(b.getFree('bar')).element('a', b =>
          b
            .append(b.getFree('baz'))
            .element('em', b => b.append(b.getFree('boo')).append(b.getFree('brew')))
            .append(b.getFree('bat'))
        )
      )
      .element('span', b => b.element('span', b => b.append(b.getFree('flute'))))
      .append(b.getFree('argh'))
);

test1('simple blocks', `<div>{{#if admin}}<p>{{user}}</p>{{/if}}!</div>`, b =>
  b.element('div', b =>
    b
      .block('if', {
        params: [b.getFree('admin')],
        block: (b: InlineBlockBuilder) => b.element('p', b => b.append(b.getFree('user'))),
      })
      .text('!')
  )
);

test1('nested blocks', `<div>{{#if admin}}{{#if access}}<p>{{user}}</p>{{/if}}{{/if}}!</div>`, b =>
  b.element('div', b =>
    b
      .block('if', {
        params: [b.getFree('admin')],
        block: b =>
          b.block('if', {
            params: [b.getFree('access')],
            block: b => b.element('p', b => b.append(b.getFree('user'))),
          }),
      })
      .text('!')
  )
);

test1(
  'loops',
  `<div>{{#each people key="handle" as |p|}}<span>{{p.handle}}</span> - {{p.name}}{{/each}}</div>`,
  b =>
    b.element('div', el =>
      el.block('each', {
        params: [el.getFree('people')],
        hash: { key: 'handle' },
        locals: ['p'],
        block: block =>
          block
            .element('span', b => b.append(block.getLocal('p', 'handle')))
            .text(' - ')
            .append(block.getLocal('p', 'name')),
      })
    )
);

test1('simple helpers', `<div>{{testing title}}</div>`, b =>
  b.element('div', b => b.append(b.helper('testing', [b.getFree('title')])))
);

test1('constant negative numbers', `<div>{{testing -123321}}</div>`, b =>
  b.element('div', b => b.append(b.helper('testing', [-123321])))
);

// @test
// 'Constant negative numbers can render'() {
//   this.registerHelper('testing', ([id]) => id);
//   this.render('<div>{{testing -123321}}</div>');
//   this.assertHTML('<div>-123321</div>');
//   this.assertStableRerender();
// }

// @test
// 'Large numeric literals (Number.MAX_SAFE_INTEGER)'() {
//   this.registerHelper('testing', ([id]) => id);
//   this.render('<div>{{testing 9007199254740991}}</div>');
//   this.assertHTML('<div>9007199254740991</div>');
//   this.assertStableRerender();
// }

// @test
// 'Constant float numbers can render'() {
//   this.registerHelper('testing', ([id]) => id);
//   this.render('<div>{{testing 0.123}}</div>');
//   this.assertHTML('<div>0.123</div>');
//   this.assertStableRerender();
// }

// @test
// 'GH#13999 The compiler can handle simple helpers with inline null parameter'() {
//   let value;
//   this.registerHelper('say-hello', function(params) {
//     value = params[0];
//     return 'hello';
//   });
//   this.render('<div>{{say-hello null}}</div>');
//   this.assertHTML('<div>hello</div>');
//   this.assert.strictEqual(value, null, 'is null');
//   this.assertStableRerender();
// }

// @test
// 'GH#13999 The compiler can handle simple helpers with inline string literal null parameter'() {
//   let value;
//   this.registerHelper('say-hello', function(params) {
//     value = params[0];
//     return 'hello';
//   });

//   this.render('<div>{{say-hello "null"}}</div>');
//   this.assertHTML('<div>hello</div>');
//   this.assert.strictEqual(value, 'null', 'is null string literal');
//   this.assertStableRerender();
// }

// @test
// 'GH#13999 The compiler can handle simple helpers with inline undefined parameter'() {
//   let value: unknown = 'PLACEHOLDER';
//   let length;
//   this.registerHelper('say-hello', function(params) {
//     length = params.length;
//     value = params[0];
//     return 'hello';
//   });

//   this.render('<div>{{say-hello undefined}}</div>');
//   this.assertHTML('<div>hello</div>');
//   this.assert.strictEqual(length, 1);
//   this.assert.strictEqual(value, undefined, 'is undefined');
//   this.assertStableRerender();
// }

// @test
// 'GH#13999 The compiler can handle simple helpers with positional parameter undefined string literal'() {
//   let value: unknown = 'PLACEHOLDER';
//   let length;
//   this.registerHelper('say-hello', function(params) {
//     length = params.length;
//     value = params[0];
//     return 'hello';
//   });

//   this.render('<div>{{say-hello "undefined"}} undefined</div>');
//   this.assertHTML('<div>hello undefined</div>');
//   this.assert.strictEqual(length, 1);
//   this.assert.strictEqual(value, 'undefined', 'is undefined string literal');
//   this.assertStableRerender();
// }

// @test
// 'GH#13999 The compiler can handle components with undefined named arguments'() {
//   let value: unknown = 'PLACEHOLDER';
//   this.registerHelper('say-hello', function(_, hash) {
//     value = hash['foo'];
//     return 'hello';
//   });

//   this.render('<div>{{say-hello foo=undefined}}</div>');
//   this.assertHTML('<div>hello</div>');
//   this.assert.strictEqual(value, undefined, 'is undefined');
//   this.assertStableRerender();
// }

// @test
// 'GH#13999 The compiler can handle components with undefined string literal named arguments'() {
//   let value: unknown = 'PLACEHOLDER';
//   this.registerHelper('say-hello', function(_, hash) {
//     value = hash['foo'];
//     return 'hello';
//   });

//   this.render('<div>{{say-hello foo="undefined"}}</div>');
//   this.assertHTML('<div>hello</div>');
//   this.assert.strictEqual(value, 'undefined', 'is undefined string literal');
//   this.assertStableRerender();
// }

// @test
// 'GH#13999 The compiler can handle components with null named arguments'() {
//   let value;
//   this.registerHelper('say-hello', function(_, hash) {
//     value = hash['foo'];
//     return 'hello';
//   });

//   this.render('<div>{{say-hello foo=null}}</div>');
//   this.assertHTML('<div>hello</div>');
//   this.assert.strictEqual(value, null, 'is null');
//   this.assertStableRerender();
// }

// @test
// 'GH#13999 The compiler can handle components with null string literal named arguments'() {
//   let value;
//   this.registerHelper('say-hello', function(_, hash) {
//     value = hash['foo'];
//     return 'hello';
//   });

//   this.render('<div>{{say-hello foo="null"}}</div>');
//   this.assertHTML('<div>hello</div>');
//   this.assert.strictEqual(value, 'null', 'is null string literal');
//   this.assertStableRerender();
// }

// @test
// 'Null curly in attributes'() {
//   this.render('<div class="foo {{null}}">hello</div>');
//   this.assertHTML('<div class="foo ">hello</div>');
//   this.assertStableRerender();
// }

// @test
// 'Null in primitive syntax'() {
//   this.render('{{#if null}}NOPE{{else}}YUP{{/if}}');
//   this.assertHTML('YUP');
//   this.assertStableRerender();
// }

// @test
// 'Sexpr helpers'() {
//   this.registerHelper('testing', function(params) {
//     return params[0] + '!';
//   });

//   this.render('<div>{{testing (testing "hello")}}</div>');
//   this.assertHTML('<div>hello!!</div>');
//   this.assertStableRerender();
// }

// @test
// 'The compiler can handle multiple invocations of sexprs'() {
//   this.registerHelper('testing', function(params) {
//     return '' + params[0] + params[1];
//   });

//   this.render('<div>{{testing (testing "hello" foo) (testing (testing bar "lol") baz)}}</div>', {
//     foo: 'FOO',
//     bar: 'BAR',
//     baz: 'BAZ',
//   });
//   this.assertHTML('<div>helloFOOBARlolBAZ</div>');
//   this.assertStableRerender();
// }

// @test
// 'The compiler passes along the hash arguments'() {
//   this.registerHelper('testing', function(_, hash) {
//     return hash['first'] + '-' + hash['second'];
//   });

//   this.render('<div>{{testing first="one" second="two"}}</div>');
//   this.assertHTML('<div>one-two</div>');
//   this.assertStableRerender();
// }

// @test
// 'Attributes can be populated with helpers that generate a string'() {
//   this.registerHelper('testing', function(params) {
//     return params[0];
//   });

//   this.render('<a href="{{testing url}}">linky</a>', { url: 'linky.html' });
//   this.assertHTML('<a href="linky.html">linky</a>');
//   this.assertStableRerender();
// }

// @test
// 'Attribute helpers take a hash'() {
//   this.registerHelper('testing', function(_, hash) {
//     return hash['path'];
//   });

//   this.render('<a href="{{testing path=url}}">linky</a>', { url: 'linky.html' });
//   this.assertHTML('<a href="linky.html">linky</a>');
//   this.assertStableRerender();
// }

// @test
// 'Attributes containing multiple helpers are treated like a block'() {
//   this.registerHelper('testing', function(params) {
//     return params[0];
//   });

//   this.render('<a href="http://{{foo}}/{{testing bar}}/{{testing "baz"}}">linky</a>', {
//     foo: 'foo.com',
//     bar: 'bar',
//   });
//   this.assertHTML('<a href="http://foo.com/bar/baz">linky</a>');
//   this.assertStableRerender();
// }

// @test
// 'Elements inside a yielded block'() {
//   this.render('{{#identity}}<div id="test">123</div>{{/identity}}');
//   this.assertHTML('<div id="test">123</div>');
//   this.assertStableRerender();
// }

// @test
// 'A simple block helper can return text'() {
//   this.render('{{#identity}}test{{else}}not shown{{/identity}}');
//   this.assertHTML('test');
//   this.assertStableRerender();
// }

// @test
// 'A block helper can have an else block'() {
//   this.render('{{#render-else}}Nope{{else}}<div id="test">123</div>{{/render-else}}');
//   this.assertHTML('<div id="test">123</div>');
//   this.assertStableRerender();
// }
