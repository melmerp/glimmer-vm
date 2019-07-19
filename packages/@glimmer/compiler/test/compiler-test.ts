import { precompile, WireFormatBuilder, WireFormatDebugger } from '@glimmer/compiler';
import {
  SerializedTemplateWithLazyBlock,
  SerializedTemplate,
  WireFormat,
} from '@glimmer/interfaces';
import { assign, strip } from '@glimmer/util';
import { Namespace } from '@simple-dom/interface';

import Op = WireFormat.SexpOpcodes;

QUnit.module('@glimmer/compiler - compiling source to wire format');

function compile(content: string): SerializedTemplate<unknown> {
  let parsed = (JSON.parse(
    precompile(content, { meta: null, strict: true })
  ) as unknown) as SerializedTemplateWithLazyBlock<unknown>;
  let block = JSON.parse(parsed.block);

  return assign({}, parsed, { block });
}

function test(desc: string, template: string, expectedFn: (b: WireFormatBuilder) => void) {
  QUnit.test(desc, assert => {
    let actual = compile(template);

    let builder = new WireFormatBuilder();
    expectedFn(builder);

    let expected = builder.toTemplate({ meta: null, id: null });

    let debugExpected = new WireFormatDebugger(expected.block).format();
    let debugActual = new WireFormatDebugger(actual.block).format();

    assert.deepEqual(debugActual, debugExpected);
  });
}

test('HTML text content', 'content', b => b.text('content'));

test('Text curlies', '<div>{{title}}<span>{{title}}</span></div>', b => {
  b.element('div', {
    body: b => {
      b.append(b.getFree('title'));
      b.element('span', { body: b => b.append(b.getFree('title')) });
    },
  });
});

test(
  'Smoke test (integration, basic)',
  '<div ...attributes><@foo @staticNamedArg="static" data-test1={{@outerArg}} data-test2="static" @dynamicNamedArg={{@outerArg}} /></div>',
  b => {
    b.element('div', {
      attrs: b => b.attrSplat(),
      body: b => {
        b.dynamicComponent(b.getArg('@foo'), {
          params: b => {
            b.arg('@staticNamedArg', 'static');
            b.attr('data-test1', b.getArg('@outerArg'));
            b.attr('data-test2', 'static');
            b.arg('@dynamicNamedArg', b.getArg('@outerArg'));
          },
        });
      },
    });
  }
);

test('elements', '<h1>hello!</h1><div>content</div>', b => {
  b.element('h1', { body: b => b.text('hello!') });
  b.element('div', { body: b => b.text('content') });
});

test('attributes', "<div class='foo' id='bar'>content</div>", b => {
  b.element('div', {
    attrs: b => b.attr('class', 'foo').attr('id', 'bar'),
    body: b => b.text('content'),
  });
});

test('data attributes', "<div data-some-data='foo'>content</div>", b => {
  b.element('div', {
    attrs: b => b.attr('data-some-data', 'foo'),
    body: b => b.text('content'),
  });
});

test('checked attributes', "<input checked='checked'>", b => {
  b.element('input', {
    attrs: b => b.attr('checked', 'checked'),
  });
});

test(
  'selected options',
  strip`
     <select>
       <option>1</option>
       <option selected>2</option>
       <option>3</option>
     </select>`,
  b => {
    b.element('select', {
      body: b =>
        b
          .text('\n  ')
          .element('option', {
            body: b => b.text('1'),
          })
          .text('\n  ')
          .element('option', {
            attrs: b => b.attr('selected', ''),
            body: b => b.text('2'),
          })
          .text('\n  ')
          .element('option', { body: b => b.text('3') })
          .text('\n'),
    });
  }
);

test(
  'multi-select options',
  strip`
     <select multiple>
       <option>1</option>
       <option selected>2</option>
       <option selected>3</option>
     </select>`,
  b => {
    b.element('select', {
      attrs: b => b.attr('multiple', ''),
      body: b =>
        b
          .text('\n  ')
          .element('option', {
            body: b => b.text('1'),
          })
          .text('\n  ')
          .element('option', {
            attrs: b => b.attr('selected', ''),
            body: b => b.text('2'),
          })
          .text('\n  ')
          .element('option', {
            attrs: b => b.attr('selected', ''),
            body: b => b.text('3'),
          })
          .text('\n'),
    });
  }
);

let voidElements = 'area base br embed hr img input keygen link meta param source track wbr';
voidElements.split(' ').forEach(tagName => {
  test(`void ${tagName}`, `<${tagName}>`, b => b.element(tagName));
});

test(
  'nested HTML',
  "<div class='foo'><p><span id='bar' data-foo='bar'>hi!</span></p></div>&nbsp;More content",
  b => {
    b.element('div', {
      attrs: b => b.attr('class', 'foo'),
      body: b =>
        b.element('p', b =>
          b.element('span', {
            attrs: b => b.attr('id', 'bar').attr('data-foo', 'bar'),
            body: b => b.text('hi!'),
          })
        ),
    }).text('\u00a0More content');
  }
);

test('custom elements', '<use-the-platform></use-the-platform>', b =>
  b.element('use-the-platform')
);

test(
  'nested custom elements',
  "<use-the-platform><seriously-please data-foo='1'>Stuff <div>Here</div></seriously-please></use-the-platform>",
  b =>
    b.element('use-the-platform', b =>
      b.element('seriously-please', {
        attrs: b => b.attr('data-foo', '1'),
        body: b => b.text('Stuff ').element('div', b => b.text('Here')),
      })
    )
);

test(
  'moar nested Custom Elements',
  "<use-the-platform><seriously-please data-foo='1'><wheres-the-platform>Here</wheres-the-platform></seriously-please></use-the-platform>",
  b =>
    b.element('use-the-platform', b =>
      b.element('seriously-please', {
        attrs: b => b.attr('data-foo', '1'),
        body: b => b.element('wheres-the-platform', { body: b => b.text('Here') }),
      })
    )
);

test(
  'Custom Elements with dynamic attributes',
  "<fake-thing><other-fake-thing data-src='extra-{{someDynamicBits}}-here' /></fake-thing>",
  b => {
    b.element('fake-thing', b =>
      b.element('other-fake-thing', {
        attrs: b => b.attr('data-src', b.concat('extra-', b.getFree('someDynamicBits'), '-here')),
      })
    );
  }
);

test('Custom Elements with dynamic content', '<x-foo><x-bar>{{derp}}</x-bar></x-foo>', b => {
  b.element('x-foo', b => b.element('x-bar', b => b.append(b.getFree('derp'))));
});

test('helpers', '<div>{{testing title}}</div>', b => {
  b.element('div', b => b.append(b.helper('testing', [b.getFree('title')])));
});

test(
  'Dynamic content within single custom element',
  '<x-foo>{{#if derp}}Content Here{{/if}}</x-foo>',
  b => {
    b.element('x-foo', b =>
      b.block('if', {
        params: [b.getFree('derp')],
        blocks: { default: b => b.text('Content Here') },
      })
    );
  }
);

test(
  'Dynamic content within single custom element',
  '<x-foo>{{#if derp}}Content Here{{/if}}</x-foo>',
  b =>
    b.element('x-foo', b =>
      b.block('if', {
        params: [b.getFree('derp')],
        blocks: {
          default: b => b.text('Content Here'),
        },
      })
    )
);

test('quotes in HTML', `<div>"This is a title," we're on a boat</div>`, b => {
  b.element('div', b => b.text(`"This is a title," we're on a boat`));
});

test('backslashes in HTML', `<div>This is a backslash: \\</div>`, b => {
  b.element('div', b => b.text(`This is a backslash: \\`));
});

test('newlines in HTML', `<div>common\n\nbro</div>`, b => {
  b.element('div', b => b.text(`common\n\nbro`));
});

test('empty attributes', `<div class=''>content</div>`, b => {
  b.element('div', { attrs: b => b.attr('class', ''), body: b => b.text(`content`) });
});

test('helpers in string attributes', `<a href="http://{{testing 123}}/index.html">linky</a>`, b => {
  b.element('a', {
    attrs: b => b.attr('href', b.concat('http://', b.helper('testing', [123]), '/index.html')),
    body: b => b.text('linky'),
  });
});

test(`boolean attribute 'disabled'`, '<input disabled>', b =>
  b.element('input', {
    attrs: b => b.attr('disabled', ''),
  })
);

test(`string quoted attributes`, `<input disabled="{{isDisabled}}">`, b => {
  b.element('input', { attrs: b => b.attr('disabled', b.concat(b.getFree('isDisabled'))) });
});

test(`unquoted attributes`, `<img src={{src}}>`, b =>
  b.element('img', { attrs: b => b.attr('src', b.getFree('src')) })
);

test(`dynamic attr followed by static attr`, `<div foo='{{funstuff}}' name='Alice'></div>`, b =>
  b.element('div', {
    attrs: b => b.attr('foo', b.concat(b.getFree('funstuff'))).attr('name', 'Alice'),
  })
);

test(
  `dynamic selected options`,
  strip`
    <select>
      <option>1</option>
      <option selected={{selected}}>2</option>
      <option>3</option>
    </select>`,
  b =>
    b.element('select', b =>
      b
        .text('\n  ')
        .element('option', b => b.text('1'))
        .text('\n  ')
        .element('option', {
          attrs: b => b.attr('selected', b.getFree('selected')),
          body: b => b.text('2'),
        })
        .text('\n  ')
        .element('option', b => b.text('3'))
        .text('\n')
    )
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
  b =>
    b.element('select', {
      attrs: b => b.attr('multiple', ''),
      body: b =>
        b
          .text('\n  ')
          .element('option', b => b.text('0'))
          .text('\n  ')
          .element('option', {
            attrs: b => b.attr('selected', b.getFree('somethingTrue')),
            body: b => b.text('1'),
          })
          .text('\n  ')
          .element('option', {
            attrs: b => b.attr('selected', b.getFree('somethingTruthy')),
            body: b => b.text('2'),
          })
          .text('\n  ')
          .element('option', {
            attrs: b => b.attr('selected', b.getFree('somethingUndefined')),
            body: b => b.text('3'),
          })
          .text('\n  ')
          .element('option', {
            attrs: b => b.attr('selected', b.getFree('somethingNull')),
            body: b => b.text('4'),
          })
          .text('\n  ')
          .element('option', {
            attrs: b => b.attr('selected', b.getFree('somethingFalse')),
            body: b => b.text('5'),
          })
          .text('\n'),
    })
);

test('HTML comments', `<div><!-- Just passing through --></div>`, b =>
  b.element('div', b => b.comment(' Just passing through '))
);

test('curlies in HTML comments', `<div><!-- {{foo}} --></div>`, b =>
  b.element('div', b => b.comment(' {{foo}} '))
);

test('complex curlies in HTML comments', `<div><!-- {{foo bar baz}} --></div>`, b =>
  b.element('div', b => b.comment(' {{foo bar baz}} '))
);

test(
  'handlebars blocks in HTML comments',
  `<div><!-- {{#each foo as |bar|}}\n{{bar}}\n\n{{/each}} --></div>`,
  b => b.element('div', b => b.comment(` {{#each foo as |bar|}}\n{{bar}}\n\n{{/each}} `))
);

test('top-level comments', `<!-- {{foo}} -->`, b => b.comment(` {{foo}} `));

test('handlebars comments', `<div>{{! Better not break! }}content</div>`, b =>
  b.element('div', b => b.text(`content`))
);

test('namespaced attribute', `<svg xlink:title='svg-title'>content</svg>`, b =>
  b.element('svg', {
    attrs: b => b.attr('xlink:title', 'svg-title', Namespace.XLink),
    body: b => b.text('content'),
  })
);

// @test
// 'Namespaced attribute'() {
//   this.render("<svg xlink:title='svg-title'>content</svg>");
//   this.assertHTML("<svg xlink:title='svg-title'>content</svg>");
//   this.assertStableRerender();
// }

// @test
// 'svg href attribute with quotation marks'() {
//   this.render(
//     `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="{{iconLink}}"></use></svg>`,
//     { iconLink: 'home' }
//   );
//   this.assertHTML(
//     `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="home"></use></svg>`
//   );
//   let svg = this.element.firstChild;
//   if (assertNodeTagName(svg, 'svg')) {
//     let use = svg.firstChild;
//     if (assertNodeTagName(use, 'use')) {
//       this.assert.equal(use.href.baseVal, 'home');
//     }
//   }
// }

// @test
// 'svg href attribute without quotation marks'() {
//   this.render(
//     `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href={{iconLink}}></use></svg>`,
//     { iconLink: 'home' }
//   );
//   this.assertHTML(
//     `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="home"></use></svg>`
//   );
//   let svg = this.element.firstChild;
//   if (assertNodeTagName(svg, 'svg')) {
//     let use = svg.firstChild;
//     if (assertNodeTagName(use, 'use')) {
//       this.assert.equal(use.href.baseVal, 'home');
//     }
//   }
// }

// @test
// '<svg> tag with case-sensitive attribute'() {
//   this.render('<svg viewBox="0 0 0 0"></svg>');
//   this.assertHTML('<svg viewBox="0 0 0 0"></svg>');
//   let svg = this.element.firstChild;
//   if (assertNodeTagName(svg, 'svg')) {
//     this.assert.equal(svg.namespaceURI, Namespace.SVG);
//     this.assert.equal(svg.getAttribute('viewBox'), '0 0 0 0');
//   }
//   this.assertStableRerender();
// }

// @test
// 'nested element in the SVG namespace'() {
//   let d = 'M 0 0 L 100 100';
//   this.render(`<svg><path d="${d}"></path></svg>`);
//   this.assertHTML(`<svg><path d="${d}"></path></svg>`);

//   let svg = this.element.firstChild;

//   if (assertNodeTagName(svg, 'svg')) {
//     this.assert.equal(svg.namespaceURI, Namespace.SVG);

//     let path = svg.firstChild;
//     if (assertNodeTagName(path, 'path')) {
//       this.assert.equal(
//         path.namespaceURI,
//         Namespace.SVG,
//         'creates the path element with a namespace'
//       );
//       this.assert.equal(path.getAttribute('d'), d);
//     }
//   }

//   this.assertStableRerender();
// }

// @test
// '<foreignObject> tag has an SVG namespace'() {
//   this.render('<svg><foreignObject>Hi</foreignObject></svg>');
//   this.assertHTML('<svg><foreignObject>Hi</foreignObject></svg>');

//   let svg = this.element.firstChild;

//   if (assertNodeTagName(svg, 'svg')) {
//     this.assert.equal(svg.namespaceURI, Namespace.SVG);

//     let foreignObject = svg.firstChild;

//     if (assertNodeTagName(foreignObject, 'foreignObject')) {
//       this.assert.equal(
//         foreignObject.namespaceURI,
//         Namespace.SVG,
//         'creates the foreignObject element with a namespace'
//       );
//     }
//   }

//   this.assertStableRerender();
// }

// @test
// 'Namespaced and non-namespaced elements as siblings'() {
//   this.render('<svg></svg><svg></svg><div></div>');
//   this.assertHTML('<svg></svg><svg></svg><div></div>');

//   this.assert.equal(
//     (this.element.childNodes[0] as Node).namespaceURI,
//     Namespace.SVG,
//     'creates the first svg element with a namespace'
//   );

//   this.assert.equal(
//     (this.element.childNodes[1] as Node).namespaceURI,
//     Namespace.SVG,
//     'creates the second svg element with a namespace'
//   );

//   this.assert.equal(
//     (this.element.childNodes[2] as Node).namespaceURI,
//     XHTML_NAMESPACE,
//     'creates the div element without a namespace'
//   );

//   this.assertStableRerender();
// }

// @test
// 'Namespaced and non-namespaced elements with nesting'() {
//   this.render('<div><svg></svg></div><div></div>');

//   let firstDiv = this.element.firstChild;
//   let secondDiv = this.element.lastChild;
//   let svg = firstDiv && firstDiv.firstChild;

//   this.assertHTML('<div><svg></svg></div><div></div>');

//   if (assertNodeTagName(firstDiv, 'div')) {
//     this.assert.equal(
//       firstDiv.namespaceURI,
//       XHTML_NAMESPACE,
//       "first div's namespace is xhtmlNamespace"
//     );
//   }

//   if (assertNodeTagName(svg, 'svg')) {
//     this.assert.equal(svg.namespaceURI, Namespace.SVG, "svg's namespace is svgNamespace");
//   }

//   if (assertNodeTagName(secondDiv, 'div')) {
//     this.assert.equal(
//       secondDiv.namespaceURI,
//       XHTML_NAMESPACE,
//       "last div's namespace is xhtmlNamespace"
//     );
//   }

//   this.assertStableRerender();
// }

// @test
// 'Case-sensitive tag has capitalization preserved'() {
//   this.render('<svg><linearGradient id="gradient"></linearGradient></svg>');
//   this.assertHTML('<svg><linearGradient id="gradient"></linearGradient></svg>');
//   this.assertStableRerender();
// }

// @test
// 'Text curlies'() {
//   this.render('<div>{{title}}<span>{{title}}</span></div>', { title: 'hello' });
//   this.assertHTML('<div>hello<span>hello</span></div>');
//   this.assertStableRerender();

//   this.rerender({ title: 'goodbye' });
//   this.assertHTML('<div>goodbye<span>goodbye</span></div>');
//   this.assertStableNodes();

//   this.rerender({ title: '' });
//   this.assertHTML('<div><span></span></div>');
//   this.assertStableNodes();

//   this.rerender({ title: 'hello' });
//   this.assertHTML('<div>hello<span>hello</span></div>');
//   this.assertStableNodes();
// }

// @test
// 'Repaired text nodes are ensured in the right place Part 1'() {
//   this.render('{{a}} {{b}}', { a: 'A', b: 'B', c: 'C', d: 'D' });
//   this.assertHTML('A B');
//   this.assertStableRerender();
// }

// @test
// 'Repaired text nodes are ensured in the right place Part 2'() {
//   this.render('<div>{{a}}{{b}}{{c}}wat{{d}}</div>', { a: 'A', b: 'B', c: 'C', d: 'D' });
//   this.assertHTML('<div>ABCwatD</div>');
//   this.assertStableRerender();
// }

// @test
// 'Repaired text nodes are ensured in the right place Part 3'() {
//   this.render('{{a}}{{b}}<img><img><img><img>', { a: 'A', b: 'B', c: 'C', d: 'D' });
//   this.assertHTML('AB<img><img><img><img>');
//   this.assertStableRerender();
// }

// @test
// 'Path expressions'() {
//   this.render('<div>{{model.foo.bar}}<span>{{model.foo.bar}}</span></div>', {
//     model: { foo: { bar: 'hello' } },
//   });
//   this.assertHTML('<div>hello<span>hello</span></div>');
//   this.assertStableRerender();

//   this.rerender({ model: { foo: { bar: 'goodbye' } } });
//   this.assertHTML('<div>goodbye<span>goodbye</span></div>');
//   this.assertStableNodes();

//   this.rerender({ model: { foo: { bar: '' } } });
//   this.assertHTML('<div><span></span></div>');
//   this.assertStableNodes();

//   this.rerender({ model: { foo: { bar: 'hello' } } });
//   this.assertHTML('<div>hello<span>hello</span></div>');
//   this.assertStableNodes();
// }

// @test
// 'Text curlies perform escaping'() {
//   this.render('<div>{{title}}<span>{{title}}</span></div>', { title: '<strong>hello</strong>' });
//   this.assertHTML(
//     '<div>&lt;strong&gt;hello&lt;/strong&gt;<span>&lt;strong>hello&lt;/strong&gt;</span></div>'
//   );
//   this.assertStableRerender();

//   this.rerender({ title: '<i>goodbye</i>' });
//   this.assertHTML('<div>&lt;i&gt;goodbye&lt;/i&gt;<span>&lt;i&gt;goodbye&lt;/i&gt;</span></div>');
//   this.assertStableNodes();

//   this.rerender({ title: '' });
//   this.assertHTML('<div><span></span></div>');
//   this.assertStableNodes();

//   this.rerender({ title: '<strong>hello</strong>' });
//   this.assertHTML(
//     '<div>&lt;strong&gt;hello&lt;/strong&gt;<span>&lt;strong>hello&lt;/strong&gt;</span></div>'
//   );
//   this.assertStableNodes();
// }

// @test
// 'Rerender respects whitespace'() {
//   this.render('Hello {{ foo }} ', { foo: 'bar' });
//   this.assertHTML('Hello bar ');
//   this.assertStableRerender();

//   this.rerender({ foo: 'baz' });
//   this.assertHTML('Hello baz ');
//   this.assertStableNodes();

//   this.rerender({ foo: '' });
//   this.assertHTML('Hello  ');
//   this.assertStableNodes();

//   this.rerender({ foo: 'bar' });
//   this.assertHTML('Hello bar ');
//   this.assertStableNodes();
// }

// @test
// 'Safe HTML curlies'() {
//   let title = {
//     toHTML() {
//       return '<span>hello</span> <em>world</em>';
//     },
//   };
//   this.render('<div>{{title}}</div>', { title });
//   this.assertHTML('<div><span>hello</span> <em>world</em></div>');
//   this.assertStableRerender();
// }

// @test
// 'Triple curlies'() {
//   let title = '<span>hello</span> <em>world</em>';
//   this.render('<div>{{{title}}}</div>', { title });
//   this.assertHTML('<div><span>hello</span> <em>world</em></div>');
//   this.assertStableRerender();
// }

// @test
// 'Triple curlie helpers'() {
//   this.registerHelper('unescaped', ([param]) => param);
//   this.registerHelper('escaped', ([param]) => param);
//   this.render('{{{unescaped "<strong>Yolo</strong>"}}} {{escaped "<strong>Yolo</strong>"}}');
//   this.assertHTML('<strong>Yolo</strong> &lt;strong&gt;Yolo&lt;/strong&gt;');
//   this.assertStableRerender();
// }

// @test
// 'Top level triple curlies'() {
//   let title = '<span>hello</span> <em>world</em>';
//   this.render('{{{title}}}', { title });
//   this.assertHTML('<span>hello</span> <em>world</em>');
//   this.assertStableRerender();
// }

// @test
// 'Top level unescaped tr'() {
//   let title = '<tr><td>Yo</td></tr>';
//   this.render('<table>{{{title}}}</table>', { title });
//   this.assertHTML('<table><tbody><tr><td>Yo</td></tr></tbody></table>');
//   this.assertStableRerender();
// }

// @test
// 'The compiler can handle top-level unescaped td inside tr contextualElement'() {
//   this.render('{{{html}}}', { html: '<td>Yo</td>' });
//   this.assertHTML('<tr><td>Yo</td></tr>');
//   this.assertStableRerender();
// }

// @test
// 'Extreme nesting'() {
//   this.render(
//     '{{foo}}<span>{{bar}}<a>{{baz}}<em>{{boo}}{{brew}}</em>{{bat}}</a></span><span><span>{{flute}}</span></span>{{argh}}',
//     {
//       foo: 'FOO',
//       bar: 'BAR',
//       baz: 'BAZ',
//       boo: 'BOO',
//       brew: 'BREW',
//       bat: 'BAT',
//       flute: 'FLUTE',
//       argh: 'ARGH',
//     }
//   );
//   this.assertHTML(
//     'FOO<span>BAR<a>BAZ<em>BOOBREW</em>BAT</a></span><span><span>FLUTE</span></span>ARGH'
//   );
//   this.assertStableRerender();
// }

// @test
// 'Simple blocks'() {
//   this.render('<div>{{#if admin}}<p>{{user}}</p>{{/if}}!</div>', {
//     admin: true,
//     user: 'chancancode',
//   });
//   this.assertHTML('<div><p>chancancode</p>!</div>');
//   this.assertStableRerender();

//   let p = this.element.firstChild!.firstChild!;

//   this.rerender({ admin: false });
//   this.assertHTML('<div><!---->!</div>');
//   this.assertStableNodes({ except: p });

//   let comment = this.element.firstChild!.firstChild!;

//   this.rerender({ admin: true });
//   this.assertHTML('<div><p>chancancode</p>!</div>');
//   this.assertStableNodes({ except: comment });
// }

// @test
// 'Nested blocks'() {
//   this.render('<div>{{#if admin}}{{#if access}}<p>{{user}}</p>{{/if}}{{/if}}!</div>', {
//     admin: true,
//     access: true,
//     user: 'chancancode',
//   });
//   this.assertHTML('<div><p>chancancode</p>!</div>');
//   this.assertStableRerender();

//   let p = this.element.firstChild!.firstChild!;

//   this.rerender({ admin: false });
//   this.assertHTML('<div><!---->!</div>');
//   this.assertStableNodes({ except: p });

//   let comment = this.element.firstChild!.firstChild!;

//   this.rerender({ admin: true });
//   this.assertHTML('<div><p>chancancode</p>!</div>');
//   this.assertStableNodes({ except: comment });

//   p = this.element.firstChild!.firstChild!;

//   this.rerender({ access: false });
//   this.assertHTML('<div><!---->!</div>');
//   this.assertStableNodes({ except: p });
// }

// @test
// Loops() {
//   this.render(
//     '<div>{{#each people key="handle" as |p|}}<span>{{p.handle}}</span> - {{p.name}}{{/each}}</div>',
//     {
//       people: [
//         { handle: 'tomdale', name: 'Tom Dale' },
//         { handle: 'chancancode', name: 'Godfrey Chan' },
//         { handle: 'wycats', name: 'Yehuda Katz' },
//       ],
//     }
//   );

//   this.assertHTML(
//     '<div><span>tomdale</span> - Tom Dale<span>chancancode</span> - Godfrey Chan<span>wycats</span> - Yehuda Katz</div>'
//   );
//   this.assertStableRerender();

//   this.rerender({
//     people: [
//       { handle: 'tomdale', name: 'Thomas Dale' },
//       { handle: 'wycats', name: 'Yehuda Katz' },
//     ],
//   });

//   this.assertHTML(
//     '<div><span>tomdale</span> - Thomas Dale<span>wycats</span> - Yehuda Katz</div>'
//   );
// }

// @test
// 'Simple helpers'() {
//   this.registerHelper('testing', ([id]) => id);
//   this.render('<div>{{testing title}}</div>', { title: 'hello' });
//   this.assertHTML('<div>hello</div>');
//   this.assertStableRerender();
// }

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
