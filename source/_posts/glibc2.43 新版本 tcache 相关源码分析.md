---
title: glibc2.43 新版本 tcache 相关源码分析
date: '2026-05-07 00:00:00'
updated: '2026-05-07 00:00:00'
categories:
  - 知识分享
tags:
  - glibc
  - tcache
---

# glibc2.43 新版本 tcache 相关源码分析

## `tcache_perthread_struct` 定义

```c
// glibc2.43: malloc.c line 2910
typedef struct tcache_perthread_struct
{
  uint16_t num_slots[TCACHE_MAX_BINS];
  tcache_entry *entries[TCACHE_MAX_BINS];
} tcache_perthread_struct;
```

`entries[i]` ：第 `i` 个 `tcache bin` 的链表头

`num_slots[i]` : 这个 `bin` 还能放多少个 `chunk` ，这里与 `glibc 2.39` 存在差异，由 `counts[]` 变成了 `num_slots[]`

## `tcache_put_n` 定义

这段 `tcache_put_n` 是 `glibc 2.43` 把一个 `free chunk` 放进当前线程 `tcache` 的核心代码。

```c
// glibc2.43: malloc.c line 3015 
tcache_put_n (mchunkptr chunk, size_t tc_idx, tcache_entry **ep, bool mangled)
{
  tcache_entry *e = (tcache_entry *) chunk2mem (chunk); 

  /* Mark this chunk as "in the tcache" so the test in __libc_free will
     detect a double free.  */
  e->key = tcache_key; // 标记这个 chunk 已经在 tcache 里了，这样 __libc_free 里就能检测到 double free 了

  if (!mangled) 
    { 
      e->next = PROTECT_PTR (&e->next, *ep); 
      *ep = e;  
    }
  else
    {
      e->next = PROTECT_PTR (&e->next, REVEAL_PTR (*ep));
      *ep = PROTECT_PTR (ep, e); 
    }
  --(tcache->num_slots[tc_idx]); // 这个 tc_idx 的 tcache bin 里又少了一个空位了
}

```

这里可以看到 `tcache` 的逻辑发生了完全相反的改变，`--(tcache->num_slots[tc_idx])` 表示当前还剩多少槽位，以往的 `glibc2.39` 版本是 `++(tcache->counts[tc_idx])` 记录已有多少 `chunk` 。

其中 `# define TCACHE_FILL_COUNT 16` 默认定义了 `num_slots[tc_idx]` 最大值是 `16` ，也就是说初始 `bin`，`num_slots[i] = 16` ，每放进一个 `chunk` ： ` num_slots[i]--` ，每取出一个 `chunk` ：`num_slots[i]++` 。

## `tcache_entry` 定义

```c
// glibc2.43 : malloc.c line 2897
typedef struct tcache_entry
{
  struct tcache_entry *next;
  /* This field exists to detect double frees.  */
  uintptr_t key;
} tcache_entry;
```

`key` 用来做 `double free` 检查 ，值得一提的是 ，`glibc2.43` 对 `double free` 的检查更加严格，相关代码如下：

**调用点：**

```c
// glibc2.43 malloc.c line 3365
#if USE_TCACHE
  if (__glibc_likely (size < mp_.tcache_max_bytes))
    {
      /* Check to see if it's already in the tcache.  */
      tcache_entry *e = (tcache_entry *) chunk2mem (p);

      /* Check for double free - verify if the key matches.  */
      if (__glibc_unlikely (e->key == tcache_key))
        return tcache_double_free_verify (e);

      size_t tc_idx = csize2tidx (size);
      if (__glibc_likely (tc_idx < TCACHE_SMALL_BINS))
	{
          if (__glibc_likely (tcache->num_slots[tc_idx] != 0))
	    return tcache_put (p, tc_idx);
	}
      else
	{
	  tc_idx = large_csize2tidx (size);
	  if (size >= MINSIZE
              && __glibc_likely (tcache->num_slots[tc_idx] != 0))
	    return tcache_put_large (p, tc_idx);
	}

      if (__glibc_unlikely (tcache_inactive ()))
	return tcache_free_init (mem);
    }
#endif
```

在 `__libc_free` 里，`glibc` 先把要释放的 `chunk` 用户区解释成 `tcache_entry` ：`tcache_entry *e = (tcache_entry *) chunk2mem (p);` ，然后做一个简单的怀疑判断：`if (e->key == tcache_key)` ：

- 如果 e->key != tcache_key：大概率没在 tcache 里，继续正常 free
- 如果 e->key == tcache_key：怀疑这个 chunk 已经进过 tcache，于是进入复核函数

## `tcache_double_free_verify` 定义

```c
// glibc2.43: malloc.c line 3161
tcache_double_free_verify (tcache_entry *e)
{
  tcache_entry *tmp;
  for (size_t tc_idx = 0; tc_idx < TCACHE_MAX_BINS; ++tc_idx) // 遍历所有 tcache bins
    {
      size_t cnt = 0;
      LIBC_PROBE (memory_tcache_double_free, 2, e, tc_idx);
      for (tmp = tcache->entries[tc_idx];
	   tmp;
	   tmp = REVEAL_PTR (tmp->next), ++cnt) // 顺着每个 bin 的单链表往后走
	{
	  if (cnt >= mp_.tcache_count) // 链表长度不能超过上限 默认情况下是 16
	    malloc_printerr ("free(): too many chunks detected in tcache");
	  if (__glibc_unlikely (misaligned_mem (tmp))) // tcache 里的 chunk 用户区地址必须满足 malloc 对齐要求
	    malloc_printerr ("free(): unaligned chunk detected in tcache 2");
	  if (tmp == e) // e 是这次准备 free 的 chunk 用户区地址，如果在 tcache 里找到了 e，说明 e 已经在 tcache 里了，这次又准备 free 一次，说明 double free 了
	    malloc_printerr ("free(): double free detected in tcache 2");
	}
    }
  /* No double free detected - it might be in a tcache of another thread,
     or user data that happens to match the key.  Since we are not sure,
     clear the key and retry freeing it.  */
  e->key = 0;
  __libc_free (e);
}
```

通过阅读源码可以看出，复合函数有三个检查，分别是检查链表长度、检查 `chunk` 用户区地址对齐 、检查释放的 `chunk` 的用户区地址是否已经在 `tcache` 链表里 。

在 `glibc2.39` 里 ，`__libc_free` 直接内联做这段检查，而 `glibc2.43` 把它抽成了单独函数，且更加严格，不仅仅只查对应 `size` 的 `bin` ，而是查当前线程整个 `tcache` 表。

## `large tcache bins` 

在 `glibc 2.43` 内额外预留了 `12` 个给大 `chunk` 用的 `tcache bin` 

```c
#define TCACHE_SMALL_BINS 64
#define TCACHE_LARGE_BINS 12
#define TCACHE_MAX_BINS (TCACHE_SMALL_BINS + TCACHE_LARGE_BINS)
```

 但是默认设置还是：

```c
.tcache_max_bytes = MAX_TCACHE_SMALL_SIZE + 1
```

也就是只到 0x410 左右，所以默认行为和以前差不多。

只有当你把 tcache_max_bytes 调大后，才会用到这些新增的 large bins。

## `tcache_perthread_struct` 创建

在 `glibc2.43` 里，`tcache_perthread_struct` 不是程序一启动就立刻创建，而是按需延迟创建，线程刚开始时：

```
static __thread tcache_perthread_struct *tcache =
  (tcache_perthread_struct *) &__tcache_dummy.inactive;
```

也就是先指向一个 dummy 的 inactive 状态，不是真实分配的结构体。

而真正的创建发生在调用 `tcache_init()` 的时候：

```c
// glibc2.43 malloc.c line 3224
tcache_init (mstate av)
{
  /* Set this unconditionally to avoid infinite loops.  */
  tcache_set_disabled ();
  if (mp_.tcache_count == 0)
    return;

  size_t bytes = sizeof (tcache_perthread_struct);
  if (av)
    tcache =
      (tcache_perthread_struct *) _int_malloc (av, request2size (bytes));
  else
    tcache = (tcache_perthread_struct *) __libc_malloc2 (bytes);

  if (tcache == NULL)
    {
      /* If the allocation failed, don't try again.  */
      tcache_set_disabled ();
    }
  else
    {
      memset (tcache, 0, bytes);
      for (int i = 0; i < TCACHE_MAX_BINS; i++)
	tcache->num_slots[i] = mp_.tcache_count;
    }
}
```

**什么时候会触发 `tcache_init` 呢？**

这里主要有两种情况：

1. 第一次需要 `tcache`  的 `malloc/free` 路径
   当 `glibc` 发现当前线程的 `tcache` 还是 `inactive`，但这次操作想使用 `tcache`，就会去初始化。
2. 第一次 `free` 想把 `chunk` 放进 `tcache` 时

```c
if (__glibc_unlikely (tcache_inactive ()))
    return tcache_free_init (mem);
```

然后：

```c
static void __attribute_noinline__
tcache_free_init (void *mem)
{
  tcache_init (NULL);
  __libc_free (mem);
}
```

先初始化真实的 `tcache_perthread_struct` ，然后重新执行一次 `free` 。

**也就是说只有当前线程第一次真正需要用到 tcache 时，glibc 才会动态分配一个堆块，拿来作为这个线程的 tcache_perthread_struct。**
