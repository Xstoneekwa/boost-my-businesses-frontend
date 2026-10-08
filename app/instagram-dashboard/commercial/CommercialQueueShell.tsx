import type { ReactNode } from "react";
import styles from "./CommercialLeadReviewWorkspace.module.css";

export default function CommercialQueueShell({queue,children,mobileDetailOpen=false,busy=false}:{queue:ReactNode;children:ReactNode;mobileDetailOpen?:boolean;busy?:boolean}){
  return <div className={styles.shell} aria-busy={busy}>
    <div className={`${styles.queueSlot} ${mobileDetailOpen?styles.queueHiddenMobile:""}`}>{queue}</div>
    {children}
  </div>;
}
