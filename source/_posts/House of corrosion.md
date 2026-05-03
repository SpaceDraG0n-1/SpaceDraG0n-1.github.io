---
title: House of Corrosion
date: '2025-08-08 16:38:21'
updated: '2025-08-08 17:26:42'
permalink: posts/16109.html
categories:
  - 知识分享
tags:
  - House of 系列手法
---

# House of corrosion

### 利用范围：

- 2.23  -  至今

### 利用效果：

- 任意地址读
- 任意地址写
- 任意地址值转移

### 利用条件：

- 需要一个UAF漏洞

- 可以分配较大的堆块（size <= 0x3b00）
- 不需要泄露地址

### 利用原理：

House of corrosion 是一个针对于 global_max_fast 的相关利用技巧 ，通过一些其他的手法 ，把 global_max_fast 修改成一个极大值 ，比如 unsortedbin attack 、largebinattack 、tcache stashing unlink 等 （利用 unsortedbin attack 时不需要泄露地址，爆破 1/16 即可） ，于是我们就可以实现任意地址读写的功能 。

要想知道 House of corrosion 的具体原理 ，我们就要知道 global_max_fastbin 是什么 。

`global_max_fast` 是 glibc 堆管理器（ptmalloc2）中的一个全局变量，用于定义 `fastbins` 的最大 chunk 大小 。它决定了哪些内存块会被放入 `fastbins` 进行快速分配和释放，而不是进入更慢的 `smallbins` 或`unsorted bin` ，在引入tcachebin之前（GLIBC2.27之前），`global_max_fast` 的默认值为 0x80 也就是 `fastbin` 的size默认范围在 [0x20,0x80] 

如果我们往 `global_max_fast` 输入一个极大值的话，我们就可以造成 `fastbinY` 数组溢出 , 这样会使得我们在 malloc 和 free 堆块的时候 ，很大的 size 堆块都会被判定为是 `fastbin` 类型的堆块，`fastbinY` 是在glibc上储存`fastbin`不同大小链表头指针的一段空间，为大小从 0x20 开始的 `fastbin` 链表预留了十个指针 。

这就意味着，如果有size超过 0xb0 大小的堆块，那么这个堆块的索引值就会超出 `fastbinsY` 的最大范围 ，造成数组越界 ，通过这个原理，我们就可以把 `fastbinY`溢出到我们想要的位置 。

### 利用技巧：

**溢出到目标位置的计算公式：**

```
chunk size = (chunk addr - &main_arena.fastbinsY) x 2 + 0x2
```

#### 读原语：

<img src="/images/posts/20250808164333637.png" alt="image-20250808153203066" style="zoom: 50%;" />

想要读取到目标地址 `X` 上的 `Y`，我们可以通过释放`fastbin A` 到 `X` 处 , 这样我们的 `A` 的 `fd` 指针就指向了 `Y` ，通过打印就可以打印出 `Y` 的信息 。

#### 写原语1：

<img src="/images/posts/20250808164339824.png" alt="image-20250808153403693" style="zoom: 67%;" />

通过释放 `fastbin A` 到目标地址 `X` ，然后使用UAF漏洞修改 `A` 的 `fd` 指针为目标值`B` ，然后把 `A` 申请回来，这样我们就可以向 `X` 写入目标值 `B` 。

#### 写原语2：

<img src="/images/posts/20250808164341567.png" alt="image-20250808154110778" style="zoom:67%;" />

我们想要把地址 `M` 上的 `N` 转移到 `X` 上 

<img src="/images/posts/20250808164343070.png" alt="image-20250808154338784" style="zoom:67%;" />

就可以先通过UAF，部分写 `A` 的 `fd` 指针使其指向本身 ，形成类似 double free 的情况 

<img src="/images/posts/20250808164348004.png" alt="image-20250808154731342" style="zoom:67%;" />

再把 `A` 给申请回来，纂改 `A` 的 size ，然后释放掉 `A` ，使其落到  `M` 处 ，此时 `A` 的 `fd` 指针变成了目标值 `N` 

<img src="/images/posts/20250808164345525.png" alt="image-20250808155322692" style="zoom:67%;" />

再次纂改`A` 的 size ，使其落入 `X` ，然后我们把 `A` 给申请回来，就可以实现转移操作，将地址 `M` 的值 `N` 转移到地址 `X` 上 。

### 相关技巧：

虽然现在都可以使用 House of corrosion ，但是在 `glibc-2.37` 版本中 ，`global_max_fast` 的数据类型被修改成了 `int8_u` ，进而导致可控的空间范围大幅度缩小 。

### 组合利用：

House of corrosion 可以和多数手法组合利用，达到意想不到的效果，就比如可以结合 House of husk ，将 `__printf_arginfo_table`以及 `__printf_function_table` 修改成已知堆块地址然后进行进一步攻击，又或者说是 House of apple2 ，劫持 `_IO_list_all` 到已知堆块地址，进行 `IO_FILE`的伪造，又或是说可以结合 House of kiwi ，由于 House of kiwi 的手法利用需要触发 `assert` ，所以我们可以利用 House of corrosion 来修改 Topchunk 的 size ，使其变得不合法 ，再次申请大于写入 size 的堆块就能触发 `assert` ，总而言之，House of corrosion 的利用可以配合其他攻击手法，让我们的攻击更加灵活，还有很多组合利用方式，可以自己发挥想象。



## 参考链接：

https://xz.aliyun.com/news/6458

https://zhuanlan.zhihu.com/p/448880453

https://www.roderickchan.cn/zh-cn/2023-02-27-house-of-all-about-glibc-heap-exploitation/#29-house-of-corrosion





























































































































