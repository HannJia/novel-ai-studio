// A deliberately small arithmetic language: numbers, field names, + - * / and
// parentheses. Never interpret a formula as JavaScript or relax the page CSP.
export function evaluateFormula(expression: string, resolve: (name: string) => number): number {
  if (expression.length > 2000) throw new Error('公式超过 2000 字符')
  const tokens = expression.match(/\s+|\d+(?:\.\d*)?|\.\d+|[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff]*|\[[^\[\]\r\n]+\]|[()+\-*/]|./gu)
    ?.filter(token => !/^\s+$/.test(token)) || []
  if (tokens.length > 512) throw new Error('公式过于复杂')
  let position = 0
  let depth = 0
  const finite = (value: number) => {
    if (!Number.isFinite(value)) throw new Error('计算结果不是有限数字')
    return value
  }
  function primary(): number {
    if (++depth > 64) throw new Error('公式嵌套过深')
    try {
      const token = tokens[position++]
      if (token === '+' || token === '-') return finite((token === '-' ? -1 : 1) * primary())
      if (token === '(') {
        const result = sum()
        if (tokens[position++] !== ')') throw new Error('缺少右括号')
        return result
      }
      if (!token) throw new Error('公式缺少数字或字段')
      if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return finite(Number(token))
      if (/^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff]*$/u.test(token)) return finite(resolve(token))
      if (token.startsWith('[') && token.endsWith(']')) return finite(resolve(token.slice(1, -1).trim()))
      throw new Error(`公式包含不支持的符号：${token}`)
    } finally { depth-- }
  }
  function product(): number {
    let value = primary()
    while (tokens[position] === '*' || tokens[position] === '/') {
      const op = tokens[position++]
      const next = primary()
      if (op === '/' && next === 0) throw new Error('不能除以零')
      value = finite(op === '*' ? value * next : value / next)
    }
    return value
  }
  function sum(): number {
    let value = product()
    while (tokens[position] === '+' || tokens[position] === '-') {
      const op = tokens[position++]
      const next = product()
      value = finite(op === '+' ? value + next : value - next)
    }
    return value
  }
  const result = sum()
  if (position !== tokens.length) throw new Error(`无法解析公式：${tokens[position]}`)
  return result
}
