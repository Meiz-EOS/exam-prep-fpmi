---
id: aig-b-a09-l2b-test
title: "АиГ a09 — L2: доказательства (часть 2/2)"
kind: ticket
exam: aig-b-a09
level: L2
minutes: 24
reuse: []
---
## aig-q-1705
ticket: aig-t-2905 · level: L2
Докажите, что ранг линейного отображения равен рангу его матрицы в любых базисах.
### Эталон
- Пусть $e_1,\ldots,e_n$ — базис $V$; каждый $\phi(e_i)$ принадлежит $\operatorname{im}\phi$.
- Поэтому $\langle\phi(e_1),\ldots,\phi(e_n)\rangle\subseteq\operatorname{im}\phi$.
- Для любого $y\in\operatorname{im}\phi$ существует $x=\sum_i x_i e_i$ с $y=\phi(x)$.
- Линейность даёт $y=\sum_i x_i\phi(e_i)$; значит, включение обратное тоже верно.
- Столбцы матрицы $A_\phi$ — координаты $\phi(e_i)$, а координатный изоморфизм сохраняет размерность их оболочки.
- Следовательно, $\operatorname{rk}\phi=\dim\operatorname{im}\phi=\operatorname{rk} A_\phi$.

## aig-q-1706
ticket: aig-t-2906 · level: L2
Выведите формулу изменения матрицы линейного отображения при заменах базисов: если $\mathfrak E'=\mathfrak E S$ и $\mathfrak F'=\mathfrak F T$, то $A'_\phi=T^{-1}A_\phi S$.
### Эталон
- По определению матриц $\phi(\mathfrak E)=\mathfrak F A_\phi$ и $\phi(\mathfrak E')=\mathfrak F'A' _\phi$.
- Из $\mathfrak E'=\mathfrak E S$ и линейности следует $\phi(\mathfrak E')=\phi(\mathfrak E)S$.
- Подстановка старой матрицы даёт $\phi(\mathfrak E')=\mathfrak F A_\phi S$.
- Из $\mathfrak F'=\mathfrak F T$ получаем $\mathfrak F=\mathfrak F'T^{-1}$.
- Значит, $\phi(\mathfrak E')=\mathfrak F'T^{-1}A_\phi S$.
- Сравнение координат относительно базиса $\mathfrak F'$ даёт $A'_\phi=T^{-1}A_\phi S$.

## aig-q-1707
ticket: aig-t-2907 · level: L2
Докажите, что композиция $\phi\circ\psi$ линейна и что при согласованных базисах $A_{\phi\circ\psi}=A_\phi A_\psi$.
### Эталон
- Для $x,y\in V$: $\psi(x+y)=\psi(x)+\psi(y)$.
- Применяя аддитивность $\phi$, получают $(\phi\circ\psi)(x+y)=(\phi\circ\psi)(x)+(\phi\circ\psi)(y)$.
- Однородность следует из $(\phi\circ\psi)(\lambda x)=\phi(\lambda\psi(x))=\lambda(\phi\circ\psi)(x)$.
- Для базисных строк-векторов имеем $\psi(\mathfrak E)=\mathfrak F A_\psi$ и $\phi(\mathfrak F)=\mathfrak G A_\phi$.
- Тогда $(\phi\circ\psi)(\mathfrak E)=\phi(\mathfrak F A_\psi)=\mathfrak G A_\phi A_\psi$.
- По определению матрицы композиции это означает $A_{\phi\circ\psi}=A_\phi A_\psi$.
