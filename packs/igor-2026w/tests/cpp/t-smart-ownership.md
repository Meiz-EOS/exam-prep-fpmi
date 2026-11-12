---
id: cpp-t-smart-ownership-test
title: "C++ — tuple-like types и совместное владение (вопросы 89–92)"
kind: topic
covers: [cpp-t-089, cpp-t-090, cpp-t-091, cpp-t-092]
minutes: 24
reuse: []
---
## cpp-q-801
ticket: cpp-t-089 · level: L0
Что такое structured binding и как оно связывает имена с элементами tuple-like объекта?
### Эталон
- Объявление structured binding вводит несколько имён, связываемых с подобъектами или элементами одного объекта.
- Для tuple-like типа используются `std::tuple_size`, `std::tuple_element` и подходящая форма `get<I>`.
- `std::tuple`, `std::pair` и `std::array` — стандартные примеры tuple-like типов.

## cpp-q-802
ticket: cpp-t-089 · level: L1
Что выведет программа? Почему изменение `x` меняет элемент `p`?
```cpp
#include <iostream>
#include <tuple>
int main() {
    std::tuple<int, int> p{1, 2};
    auto& [x, y] = p;
    x = 7;
    std::cout << std::get<0>(p) << ' ' << y;
}
```
### Эталон
- Вывод: `7 2`.
- `auto&` связывает имена с элементами исходного объекта по ссылке.
- `x` обозначает первый элемент `p`; присваивание меняет именно его.

## cpp-q-803
ticket: cpp-t-090 · level: L0
Что такое `std::weak_ptr` и какие основные операции позволяют проверить и получить совместное владение?
### Эталон
- `std::weak_ptr<T>` наблюдает за объектом, которым владеют `std::shared_ptr<T>`, но не увеличивает число сильных владельцев.
- `expired()` проверяет, уничтожен ли управляемый объект; `use_count()` сообщает число сильных владельцев.
- `lock()` возвращает `shared_ptr`, если объект ещё жив, иначе пустой `shared_ptr`.

## cpp-q-804
ticket: cpp-t-090 · level: L1
Что напечатает код и почему `weak_ptr` разрывает цикл владения?
```cpp
#include <iostream>
#include <memory>
struct Node {
    std::shared_ptr<Node> next;
    std::weak_ptr<Node> previous;
    ~Node() { std::cout << "destroyed"; }
};
int main() {
    auto a = std::make_shared<Node>();
    auto b = std::make_shared<Node>();
    a->next = b;
    b->previous = a;
}
```
### Эталон
- Вывод: `destroyeddestroyed`.
- Сильное ребро `a->next` удерживает `b`, а слабое `b->previous` не удерживает `a`.
- При выходе из `main` локальные `shared_ptr` отпускают оба объекта; сильного цикла нет.

## cpp-q-805
ticket: cpp-t-091 · level: L0
Что предоставляет `std::enable_shared_from_this<T>` и что означает CRTP?
### Эталон
- `enable_shared_from_this<T>` позволяет получить `shared_ptr<T>`, разделяющий уже существующее владение объектом.
- CRTP — шаблонный базовый класс, параметризованный производным классом, например `Base<Derived>`.
- `shared_from_this()` корректно использовать после того, как объект уже включён в управляющий блок `shared_ptr`.

## cpp-q-806
ticket: cpp-t-091 · level: L1
Каков результат `shared_from_this()` в этом коде? Укажите безопасный способ создания объекта.
```cpp
#include <memory>
struct Item : std::enable_shared_from_this<Item> {
    std::shared_ptr<Item> self() { return shared_from_this(); }
};
int main() {
    Item item;
    auto p = item.self();
}
```
### Эталон
- Код компилируется, но вызов `shared_from_this()` выбрасывает `std::bad_weak_ptr`: объект не принадлежит `shared_ptr`.
- Следует создать объект под совместным владением, например `auto p = std::make_shared<Item>();`.
- Затем `p->self()` вернёт ещё один `shared_ptr`, разделяющий тот же управляющий блок.

## cpp-q-807
ticket: cpp-t-092 · level: L0
Что такое `std::any` и как получить значение сохранённого типа?
### Эталон
- `std::any` хранит одно значение произвольного копируемого типа с семантикой значения.
- `std::any_cast<T>(&a)` возвращает указатель на значение типа `T` либо `nullptr`, если тип не совпал.
- `std::any_cast<T>(a)` по значению выбрасывает `std::bad_any_cast` при несовпадении типа.

## cpp-q-808
ticket: cpp-t-092 · level: L1
Что выведет код? Что происходит при `any_cast` с несовпадающим типом?
```cpp
#include <any>
#include <iostream>
int main() {
    std::any a = 4;
    std::cout << *std::any_cast<int>(&a) << ' '
              << (std::any_cast<double>(&a) == nullptr);
}
```
### Эталон
- Вывод: `4 1`.
- Указательная форма `any_cast<double>(&a)` возвращает `nullptr`, потому что сохранённый тип — `int`.
- Указательная форма не выбрасывает `bad_any_cast` при несовпадении типа.
