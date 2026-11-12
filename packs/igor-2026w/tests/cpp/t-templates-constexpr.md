---
id: cpp-t-templates-constexpr-test
title: "C++ — SFINAE, концепты и constant expressions (вопросы 97–100)"
kind: topic
covers: [cpp-t-097, cpp-t-098, cpp-t-099, cpp-t-100]
minutes: 24
reuse: []
---
## cpp-q-817
ticket: cpp-t-097 · level: L0
Что делает `std::declval<T>()` и где его разрешено использовать?
### Эталон
- `std::declval<T>()` образует выражение типа `std::add_rvalue_reference_t<T>` без создания объекта `T`.
- Его используют в невычисляемых контекстах, например в `decltype`, чтобы исследовать выражения для типа.
- Вызов `declval` в вычисляемом контексте запрещён: функция не имеет определения.

## cpp-q-818
ticket: cpp-t-097 · level: L1
Скомпилируется ли проверка и какое значение имеет `has_size`?
```cpp
#include <type_traits>
#include <utility>
template<class T, class = void> struct has_size : std::false_type {};
template<class T>
struct has_size<T, std::void_t<decltype(std::declval<T&>().size())>> : std::true_type {};
struct A { int size() const; };
struct B {};
static_assert(has_size<A>::value);
static_assert(!has_size<B>::value);
int main() {}
```
### Эталон
- Код компилируется: оба `static_assert` истинны.
- Для `A` выражение `declval<A&>().size()` корректно, и специализация с `void_t` участвует.
- Для `B` substitution failure исключает специализацию; используется основной шаблон `false_type`.

## cpp-q-819
ticket: cpp-t-098 · level: L0
Что проверяет `std::is_base_of<Base, Derived>` и как трактуется приватное наследование?
### Эталон
- Trait проверяет, является ли `Base` базовым классом `Derived` либо тем же самым классом.
- Для двух различных типов классов результат истинен при публичном, защищённом или приватном наследовании.
- Доступность преобразования `Derived*` в `Base*` — отдельное свойство и не меняет результат trait.

## cpp-q-820
ticket: cpp-t-098 · level: L1
Что выведет код? Почему `is_base_of` и `is_convertible` дают разные ответы?
```cpp
#include <iostream>
#include <type_traits>
struct Base {};
struct Derived : private Base {};
int main() {
    std::cout << std::is_base_of_v<Base, Derived>
              << std::is_convertible_v<Derived*, Base*>;
}
```
### Эталон
- Вывод: `10`.
- `Base` является базовым классом `Derived`, поэтому `is_base_of` истинен независимо от доступа.
- Неуполномоченный код не может неявно преобразовать `Derived*` в приватную базу `Base*`; `is_convertible` ложен.

## cpp-q-821
ticket: cpp-t-099 · level: L0
Что такое концепт и как его применяют как ограничение шаблона?
### Эталон
- Концепт — именованное булево ограничение, задаваемое через `concept`.
- Ограничение задают через `requires` или сокращённую форму с концептом в списке параметров.
- Ограниченный шаблон участвует в выборе только при выполненном ограничении.

## cpp-q-822
ticket: cpp-t-099 · level: L1
Какую перегрузку выберет `f(1)` и почему?
```cpp
#include <concepts>
#include <iostream>
template<class T> requires std::integral<T>
void f(T) { std::cout << "integral"; }
template<class T> requires std::signed_integral<T>
void f(T) { std::cout << "signed"; }
int main() { f(1); }
```
### Эталон
- Вывод: `signed`.
- Для аргумента `1` выводится `T = int`; оба ограничения выполнены.
- `std::signed_integral<T>` включает ограничение `std::integral<T>` и является более специализированным ограничением в этом выборе.

## cpp-q-823
ticket: cpp-t-100 · level: L0
Когда вычисление может быть constant expression и как в нём трактуется `throw`?
### Эталон
- Constant expression — выражение, вычисление которого удовлетворяет требованиям constant evaluation стандарта.
- `constexpr` функция может вызываться и при вычислении во время выполнения, и при constant evaluation.
- Вычисление, которое выполняет `throw`, не является допустимым constant expression; вне constant evaluation исключение может быть выброшено обычным образом.

## cpp-q-824
ticket: cpp-t-100 · level: L1
Компилируется ли код, чему равно `a` и что произойдёт при инициализации `b`?
```cpp
constexpr int value(int x) {
    if (x < 0) throw x;
    return x * 2;
}
constexpr int a = value(3);
int main() {
    int b = value(-1);
    return a + b;
}
```
### Эталон
- Код компилируется; `a` равен `6`.
- Инициализация `a` проходит constant evaluation по ветви без `throw`.
- Инициализация `b` выполняется во время выполнения и выбрасывает `int` со значением `-1`; инициализация не завершается, поэтому `b` не получает значения.
- Исключение не перехвачено, поэтому вызывается `std::terminate`; до `return` программа не доходит.
