---
id: oktch-t-dvoyka-02
title: "ОКТЧ — эквивалентность и комбинаторика (на двойку, d16–d30)"
kind: topic
covers: [oktch-t-d16, oktch-t-d17, oktch-t-d18, oktch-t-d19, oktch-t-d20, oktch-t-d21, oktch-t-d22, oktch-t-d23, oktch-t-d24, oktch-t-d25, oktch-t-d26, oktch-t-d27, oktch-t-d28, oktch-t-d29, oktch-t-d30]
minutes: 30
reuse: [oktch-q-011, oktch-q-012, oktch-q-013, oktch-q-014, oktch-q-015, oktch-q-016, oktch-q-017, oktch-q-018, oktch-q-019, oktch-q-020]
---
## oktch-q-706
ticket: oktch-t-d16 · level: L0
Определите изоморфизм упорядоченных множеств.
### Эталон
- Изоморфизм $(A,\le_A)$ и $(B,\le_B)$ — биекция $f:A\to B$, сохраняющая и отражающая порядок.
- Для всех $x,y\in A$: $x\le_A y$ тогда и только тогда, когда $f(x)\le_B f(y)$.

## oktch-q-707
ticket: oktch-t-d19 · level: L0
Сформулируйте принцип Дирихле.
### Эталон
- Если $N+1$ объектов распределены по $N$ ящикам, то хотя бы в одном ящике находятся не менее двух объектов.
- Обобщение: при $N,k\in\mathbb N$ и $N,k>0$ распределение $N$ объектов по $k$ ящикам означает, что хотя бы один ящик содержит не менее $\lceil N/k\rceil$ объектов.

## oktch-q-708
ticket: oktch-t-d22 · level: L0
Запишите формулы чисел размещений и сочетаний с повторениями и без повторений.
### Эталон
- При $n\ge1$ и $0\le k\le n$ размещения без повторений: $A_n^k=\frac{n!}{(n-k)!}$; при $n\ge1$, $k\ge0$ размещения с повторениями: $n^k$.
- При $n\ge1$ и $0\le k\le n$ сочетания без повторений: $\binom nk=\frac{n!}{k!(n-k)!}$; при $n\ge1$, $k\ge0$ сочетания с повторениями: $\binom{n+k-1}{k}$.

## oktch-q-709
ticket: oktch-t-d24 · level: L0
Сформулируйте полиномиальную формулу.
### Эталон
- $(x_1+\cdots+x_m)^n=\sum_{k_1+\cdots+k_m=n}\frac{n!}{k_1!\cdots k_m!}x_1^{k_1}\cdots x_m^{k_m}$.
- Суммирование ведётся по неотрицательным целым $k_i$.

## oktch-q-710
ticket: oktch-t-d28 · level: L0
Запишите сумму арифметической функции Мёбиуса по делителям натурального числа.
### Эталон
- $\sum_{d\mid n}\mu(d)=1$ при $n=1$.
- $\sum_{d\mid n}\mu(d)=0$ при $n>1$.
